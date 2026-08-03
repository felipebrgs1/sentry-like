import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as issue from "../controllers/issue.controller";

export const issueRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/issues", issue.recent, {
    query: t.Object({
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/issues/:id", issue.get)
  .get("/issues/:id/events", issue.events)
  .get("/issues/:id/stats", issue.stats)
  .get("/events/:id", issue.eventDetail)
  .post("/issues/:id/status", issue.updateStatus, {
    body: t.Object({
      status: t.Union([t.Literal("unresolved"), t.Literal("resolved"), t.Literal("ignored")]),
    }),
  })
  .delete("/issues/:id", issue.remove);
