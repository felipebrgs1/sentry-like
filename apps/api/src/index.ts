import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { join } from "node:path";
import { db, initBunDb } from "./db";
import { projects } from "./db/schema";
import { routes } from "./routes";
import { runRetention } from "./lib/retention";
import { runAlertChecks } from "./services/alert.service";
import { ensureBootstrap, defaultOrgId } from "./services/user.service";
import { PORT } from "./config";

// Bootstrap do banco (bun:sqlite, VPS) antes de servir qualquer request
await initBunDb();
await ensureBootstrap();

// Seed de um projeto demo para o DSN funcionar de cara
if ((await db.select().from(projects).all()).length === 0) {
  const key = crypto.randomUUID().replace(/-/g, "");
  const orgId = await defaultOrgId();
  await db
    .insert(projects)
    .values({ name: "Demo Project", publicKey: key, createdAt: Date.now(), orgId })
    .run();
  console.log(`[sentrylike] seeded "Demo Project" (id=1), public key: ${key}`);
}

/**
 * Retenção periódica no Bun (na Cloudflare vira cron trigger no worker.ts).
 */
setInterval(() => {
  runRetention().catch((e) => console.error("[sentrylike] retention failed", e));
}, 3600_000).unref();

// Alertas periódicos (spike, unresolved_age, rate_limit, digest) — 1x a cada 5min
setInterval(() => {
  runAlertChecks().catch((e) => console.error("[sentrylike] alert check failed", e));
}, 5 * 60_000).unref();

// --- static dashboard (build de produção) ---
const WEB_DIR = process.env.WEB_DIR ?? join(import.meta.dir, "../../web/dist");
// --- documentação (Astro Starlight, base "/docs") ---
const DOCS_DIR = process.env.DOCS_DIR ?? join(import.meta.dir, "../../docs/dist");
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

/**
 * Serve o build do Astro Starlight em /docs (base "/docs" → arquivos em DOCS_DIR
 * sem o prefixo). /docs raiz redireciona para a primeira página.
 */
async function serveDocs(path: string, set: { status?: number | string; headers?: unknown }) {
  const rel = path.replace(/^\/?docs\/?/, "") || "";
  if (!rel) {
    set.status = 301;
    set.headers = { location: "/docs/intro/" };
    return new Response(null);
  }
  const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".")) : "";
  let file = Bun.file(join(DOCS_DIR, rel));
  let type = MIME[ext] ?? "application/octet-stream";
  if (!ext || !(await file.exists())) {
    // página (sem extensão) → index.html da pasta; senão o 404 do Starlight
    file = Bun.file(join(DOCS_DIR, rel, "index.html"));
    type = "text/html; charset=utf-8";
    if (!(await file.exists())) {
      file = Bun.file(join(DOCS_DIR, "404.html"));
      if (!(await file.exists())) {
        set.status = 404;
        return "docs not built — run `bun run build`";
      }
      set.status = 404;
    }
  }
  return new Response(file, { headers: { "content-type": type } });
}

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
  .use(routes)
  .get("/docs", ({ set }) => serveDocs("/docs", set))
  .get("/docs/*", ({ path, set }) => serveDocs(path, set))
  .get("/*", async ({ path, set }) => {
    // path.join não trata "/" inicial como absoluto, então traversal colapsa em WEB_DIR
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
  });

app.listen(PORT);

console.log(`[sentrylike] listening on http://localhost:${PORT}`);
