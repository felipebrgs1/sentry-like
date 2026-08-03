import { Elysia } from "elysia";
import * as ingest from "../controllers/ingest.controller";

/**
 * Ingestão Sentry — PÚBLICA (autenticada pela key do DSN, como no Sentry).
 * parse: "none" mantém o body como stream cru; o controller faz o parse.
 */
export const ingestRoutes = new Elysia()
  .post("/api/:projectId/envelope/", (ctx) => ingest.envelope(ctx), { parse: "none" })
  .post("/api/:projectId/store/", (ctx) => ingest.store(ctx), { parse: "none" })
  .post("/api/:projectId/user-feedback/", (ctx) => ingest.userFeedback(ctx), { parse: "none" })
  .post("/api/tunnel", (ctx) => ingest.tunnel(ctx), { parse: "none" });
