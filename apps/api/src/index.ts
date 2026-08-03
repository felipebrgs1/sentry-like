import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { projects } from "./db/schema";
import { ingestRoutes } from "./routes/ingest";
import { apiRoutes, authRoutes } from "./routes/api";
import { ADMIN_PASSWORD, ADMIN_USER, PASSWORD_WAS_GENERATED, PORT, RETENTION_DAYS } from "./config";

// Seed a demo project so the DSN works out of the box
if (db.select().from(projects).all().length === 0) {
  const key = crypto.randomUUID().replace(/-/g, "");
  db.insert(projects).values({ name: "Demo Project", publicKey: key, createdAt: Date.now() }).run();
  console.log(`[sentrylike] seeded "Demo Project" (id=1), public key: ${key}`);
}

if (PASSWORD_WAS_GENERATED) {
  console.log(`[sentrylike] ADMIN_PASSWORD not set — generated password: ${ADMIN_PASSWORD}`);
  console.log(`[sentrylike] dashboard login: user "${ADMIN_USER}" / senha acima`);
  console.log("[sentrylike] set ADMIN_PASSWORD env var to make it stable across restarts");
}

// Retention: drop old events hourly
setInterval(
  () => {
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
    db.run(sql`DELETE FROM events WHERE timestamp < ${cutoff}`);
  },
  3600_000,
).unref();

// --- static dashboard hosting (production build) ---
const WEB_DIR = process.env.WEB_DIR ?? join(import.meta.dir, "../../web/dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

const app = new Elysia()
  .use(
    cors({
      origin: true,
      allowedHeaders: [
        "content-type",
        "content-encoding",
        "authorization",
        "x-sentry-auth",
        "sentry-trace",
        "baggage",
      ],
    }),
  )
  .get("/health", () => ({ ok: true }))
  .use(ingestRoutes)
  .use(authRoutes)
  .use(apiRoutes)
  .get("/*", async ({ path, set }) => {
    // path.join does not treat leading "/" as absolute, so traversal collapses into WEB_DIR
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
    let file = Bun.file(join(WEB_DIR, path));

    // sem extensão ou arquivo inexistente → fallback SPA (index.html)
    if (!ext || !(await file.exists())) {
      file = Bun.file(join(WEB_DIR, "index.html"));
      if (!(await file.exists())) {
        set.status = 404;
        return "dashboard not built — run `bun run build`";
      }
      return new Response(file, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response(file, {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  })
  .listen(PORT);

console.log(`[sentrylike] listening on http://localhost:${PORT}`);
