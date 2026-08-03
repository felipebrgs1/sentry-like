import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { db, initD1Db } from "./db";
import { projects } from "./db/schema";
import { routes } from "./routes";
import { runRetention } from "./lib/retention";
import { runAlertChecks } from "./services/alert.service";
import { defaultOrgId, ensureBootstrap } from "./services/user.service";
import { kvRateLimiter, setRateLimiter } from "./lib/ratelimit";
import { r2BlobStore, setBlobStore } from "./lib/storage";

/**
 * Entrypoint Cloudflare Workers.
 * - D1 (env.DB) como banco — mesmo schema/drizzle, driver assíncrono
 * - R2 (env.R2) para attachments/replays (opcional)
 * - KV (env.RATE_LIMIT_KV) para rate limit compartilhado (opcional)
 * - Static Assets (env.ASSETS) serve o SPA; API fica nas rotas /api /v1 /health
 */
export interface Env {
  DB: unknown;
  R2?: unknown;
  RATE_LIMIT_KV?: unknown;
  ASSETS: { fetch(input: string | URL | Request): Promise<Response> };
}

const app = new Elysia({ adapter: CloudflareAdapter })
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
  .compile();

let ready: Promise<void> | null = null;

/** Inicializa D1 + bindings opcionais + seed demo (uma vez por isolate). */
function ensureReady(env: Env): Promise<void> {
  ready ??= (async () => {
    await initD1Db(env.DB);
    await ensureBootstrap();
    if (env.R2) setBlobStore(r2BlobStore(env.R2));
    if (env.RATE_LIMIT_KV) setRateLimiter(kvRateLimiter(env.RATE_LIMIT_KV));
    if ((await db.select().from(projects).all()).length === 0) {
      const key = crypto.randomUUID().replace(/-/g, "");
      const orgId = await defaultOrgId();
      await db
        .insert(projects)
        .values({ name: "Demo Project", publicKey: key, createdAt: Date.now(), orgId })
        .run();
      console.log(`[sentrylike] seeded "Demo Project" (id=1), public key: ${key}`);
    }
  })();
  return ready;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureReady(env);
    const url = new URL(request.url);
    // API → Elysia; o resto (GET) → Static Assets (SPA com fallback para index.html)
    const isApi =
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/v1/") ||
      url.pathname === "/health";
    if (!isApi && request.method === "GET") {
      // docs (Astro Starlight): /docs → primeira página; 404 → página 404 do docs
      if (url.pathname === "/docs" || url.pathname === "/docs/") {
        return Response.redirect(new URL("/docs/intro/", url).href, 301);
      }
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404) {
        if (url.pathname.startsWith("/docs/")) {
          const nf = await env.ASSETS.fetch(new URL("/docs/404.html", url).href);
          return new Response(nf.body, {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        // SPA fallback (not_found_handling = "none"; o worker controla)
        return env.ASSETS.fetch(new URL("/index.html", url).href);
      }
      return res;
    }
    return app.handle(request);
  },

  /** Cron: retenção + alertas periódicos (mesma lógica dos setIntervals do Bun). */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await ensureReady(env);
    await runAlertChecks();
    await runRetention();
  },
};
