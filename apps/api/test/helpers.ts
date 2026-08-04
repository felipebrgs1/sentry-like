/**
 * Helpers compartilhados dos testes (unit + integração).
 * Cada arquivo de teste roda em um processo próprio (bun test --parallel),
 * então o banco é criado aqui sem risco de colisão entre arquivos.
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { db, initBunDb } from "../src/db";
import { projects } from "../src/db/schema";
import { routes } from "../src/routes";
import { defaultOrgId, ensureBootstrap } from "../src/services/user.service";

/** Cria o banco do teste (temp dir do preload) + owner de bootstrap. */
export async function initTestDb(): Promise<void> {
  await initBunDb();
  await ensureBootstrap();
}

/** Insere um projeto direto no banco (sem passar por HTTP) e devolve key/org. */
export async function seedProject(
  name = "Test Project",
  extra: Partial<{ allowedDomains: string[]; orgId: number | null }> = {},
): Promise<{ id: number; publicKey: string; orgId: number | null }> {
  const orgId = (extra.orgId ?? (await defaultOrgId())) || null;
  const publicKey = crypto.randomUUID().replace(/-/g, "");
  const row = await db
    .insert(projects)
    .values({
      name,
      publicKey,
      createdAt: Date.now(),
      allowedDomains: extra.allowedDomains?.length
        ? JSON.stringify(extra.allowedDomains)
        : undefined,
      orgId,
    })
    .returning({ id: projects.id, publicKey: projects.publicKey })
    .get();
  return { id: row.id, publicKey, orgId };
}

/**
 * Monta a mesma app do index.ts (cors + health + rotas) SEM listen —
 * os testes chamam `app.handle(new Request(...))` direto (Elysia in-process).
 */
export function createTestApp() {
  return new Elysia()
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
    .use(routes);
}

/** Tipo inferido da app de teste (Elysia genérico é verboso — usa este). */
export type TestApp = ReturnType<typeof createTestApp>;

const BASE = "http://localhost";

/** Faz login e devolve o token de sessão. */
export async function loginToken(
  app: TestApp,
  username = "admin",
  password = "senha123",
): Promise<string> {
  const res = await app.handle(
    new Request(`${BASE}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** fetch com autenticação por Bearer (sessão ou API token). */
export async function api(
  app: TestApp,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return app.handle(new Request(`${BASE}${path}`, { ...init, headers }));
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ------------------------------------------------------------------
// ingestão (protocolo Sentry)
// ------------------------------------------------------------------

/** Monta um envelope com 1 item `event`/`transaction`/etc. (formato EXATO do protocolo). */
export function buildEnvelope(
  itemType: string,
  event: unknown,
  dsn: string,
  headerExtra: Record<string, unknown> = {},
): string {
  const payload = JSON.stringify(event);
  const bytes = new TextEncoder().encode(payload);
  return [
    JSON.stringify({
      event_id: (event as { event_id?: string }).event_id ?? "a".repeat(32),
      ...headerExtra,
      dsn,
    }),
    JSON.stringify({ type: itemType, content_type: "application/json", length: bytes.length }),
    payload,
  ].join("\n");
}

export function sentryKeyHeader(publicKey: string): Record<string, string> {
  return {
    "content-type": "application/x-sentry-envelope",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sentrylike-test/0.1, sentry_key=${publicKey}`,
  };
}

/** POST /api/:id/envelope/ com o corpo já pronto (string | Uint8Array). */
export function postEnvelope(
  app: TestApp,
  projectId: number,
  publicKey: string,
  body: string | Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.handle(
    new Request(`${BASE}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: { ...sentryKeyHeader(publicKey), ...headers },
      body,
    }),
  );
}

/** Evento de erro padrão (fingerprint por frames in-app). */
export function makeErrorEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> & {
  event_id: string;
  timestamp: number;
  level: string;
  message: string;
} {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    release: "0.1.0",
    environment: "production",
    message: "test error",
    exception: {
      values: [
        {
          type: "TestError",
          value: "boom",
          stacktrace: {
            frames: [
              { filename: "app.js", function: "main", lineno: 10, in_app: true },
              { filename: "checkout.js", function: "processPayment", lineno: 84, in_app: true },
              { filename: "demo.js", function: "explode", lineno: 42, in_app: true },
            ],
          },
        },
      ],
    },
    ...overrides,
  };
}
