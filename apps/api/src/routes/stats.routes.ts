import { Elysia } from "elysia";
import { authGuard } from "../middleware/auth";
import * as stats from "../controllers/stats.controller";

export const statsRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/stats", stats.overview);
