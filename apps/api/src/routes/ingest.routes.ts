import { Elysia } from "elysia";
import * as ingest from "../controllers/ingest.controller";

/**
 * Ingestão Sentry — PÚBLICA (autenticada pela key do DSN, como no Sentry).
 * parse: "none" mantém o body como stream cru; o controller faz o parse.
 */
export const ingestRoutes = new Elysia()
  .post("/api/:projectId/envelope/", ingest.envelope, { parse: "none" })
  .post("/api/:projectId/store/", ingest.store, { parse: "none" });
