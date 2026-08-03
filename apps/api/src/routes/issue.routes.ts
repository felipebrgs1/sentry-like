import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as issue from "../controllers/issue.controller";

export const issueRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/issues", ({ query }) => issue.recent({ query }))
  .get("/issues/:id", ({ params, set }) => issue.get({ params, set }))
  .get("/issues/:id/events", ({ params }) => issue.events({ params }))
  .get("/issues/:id/stats", ({ params }) => issue.stats({ params }))
  .get("/events/:id", ({ params, set }) => issue.eventDetail({ params, set }))
  .post(
    "/issues/:id/status",
    ({ params, body, set }) => issue.updateStatus({ params, body, set }),
    {
      body: t.Object({
        status: t.Union([t.Literal("unresolved"), t.Literal("resolved"), t.Literal("ignored")]),
      }),
    },
  )
  .delete("/issues/:id", ({ params, set }) => issue.remove({ params, set }));
