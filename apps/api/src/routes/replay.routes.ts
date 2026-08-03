import { Elysia } from "elysia";
import { authGuard } from "../middleware/auth";
import * as replay from "../controllers/replay.controller";

/**
 * Rotas de replays (Fase 9) — protegidas pelo authGuard do dashboard.
 * A ingestão acontece pelo envelope (/api/:id/envelope/, item replay_event/recording).
 */
export const replayRoutes = new Elysia()
  .onBeforeHandle(authGuard)
  .get("/v1/projects/:id/replays", ({ params }) => replay.list({ params }))
  .get("/v1/replays/:id", ({ params, set }) => replay.detail({ params, set }))
  .delete("/v1/replays/:id", ({ params, set }) => replay.remove({ params, set }));
