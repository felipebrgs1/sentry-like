import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as sourcemap from "../controllers/sourcemap.controller";

/**
 * Rotas de sourcemaps (Fase 8):
 * - /v1/... — dashboard (authGuard de sessão/token)
 * - /api/0/... — protocolo do sentry-cli (Bearer/X-Auth-Token; org slug + projeto)
 * O upload individual é o caminho suportado: chunk-upload responde 404 de
 * propósito para o sentry-cli cair no fallback (VPS micro, sem bucket de chunks).
 */

// dashboard (protegido pelo authGuard do dashboard)
const dashboardRoutes = new Elysia()
  .onBeforeHandle(authGuard)
  .get("/v1/projects/:id/sourcemaps", ({ params, query }) => sourcemap.filesList({ params, query }))
  .get("/v1/projects/:id/sourcemap-releases", ({ params }) => sourcemap.releasesList({ params }))
  .post(
    "/v1/projects/:id/sourcemaps",
    ({ params, body, set }) => sourcemap.upload({ params, body, set }),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        release: t.String({ minLength: 1 }),
        dist: t.Optional(t.Nullable(t.String())),
        content: t.String({ minLength: 1 }), // base64
      }),
    },
  )
  .delete("/v1/sourcemaps/:id", ({ params, set }) => sourcemap.remove({ params, set }))
  .delete("/v1/projects/:id/sourcemaps", ({ params, query, set }) =>
    sourcemap.removeRelease({ params, query, set }),
  );

// protocolo do sentry-cli (autentica por API token — Bearer ou X-Auth-Token)
const sentryRoutes = new Elysia()
  .get("/api/0/organizations/:org/releases/:version/files/", (ctx) =>
    sourcemap.sentryFilesList(ctx),
  )
  .get("/api/0/projects/:org/:project/releases/:version/files/", (ctx) =>
    sourcemap.sentryFilesList(ctx),
  )
  .post(
    "/api/0/projects/:org/:project/releases/:version/files/",
    (ctx) => sourcemap.sentryUpload(ctx),
    {
      body: t.Object({
        name: t.String(),
        content: t.String(),
        dist: t.Optional(t.String()),
        header: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )
  .delete("/api/0/projects/:org/:project/releases/:version/files/:fileId/", (ctx) =>
    sourcemap.sentryDelete(ctx),
  )
  .delete("/api/0/projects/:org/:project/releases/:version/files/:fileId", (ctx) =>
    sourcemap.sentryDelete(ctx),
  )
  // força o fallback do sentry-cli para upload individual
  .get("/api/0/organizations/:org/chunk-upload/", (ctx) => sourcemap.sentryChunkUpload(ctx))
  .post("/api/0/organizations/:org/chunks/", (ctx) => sourcemap.sentryChunks(ctx))
  .post("/api/0/organizations/:org/assemble/", (ctx) => sourcemap.sentryAssemble(ctx));

export const sourcemapRoutes = new Elysia().use(dashboardRoutes).use(sentryRoutes);
