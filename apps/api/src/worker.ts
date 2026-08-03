import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { db, initD1Db } from "./db";
import { projects } from "./db/schema";
import { routes } from "./routes";
import { runRetention } from "./lib/retention";
import { runAlertChecks } from "./services/alert.service";
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
  ASSETS: { fetch(request: Request): Promise<Response> };
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
    // Cloudflare não pode gerar senha aleatória (isolates efêmeros) — avisa alto
    if (!process.env.ADMIN_PASSWORD?.trim()) {
      console.error(
        "[sentrylike] ADMIN_PASSWORD não definido! O login fica impossível na Cloudflare." +
          " Defina: echo 'sua-senha' | wrangler secret put ADMIN_PASSWORD",
      );
    }
    if (env.R2) setBlobStore(r2BlobStore(env.R2));
    if (env.RATE_LIMIT_KV) setRateLimiter(kvRateLimiter(env.RATE_LIMIT_KV));
    if ((await db.select().from(projects).all()).length === 0) {
      const key = crypto.randomUUID().replace(/-/g, "");
      await db
        .insert(projects)
        .values({ name: "Demo Project", publicKey: key, createdAt: Date.now() })
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
      return env.ASSETS.fetch(request);
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
