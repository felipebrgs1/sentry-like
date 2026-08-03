import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as issue from "../controllers/issue.controller";

export const issueRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/issues", ({ query }) => issue.recent({ query }))
  // rotas estáticas ANTES das parametrizadas (batch não pode virar ":id")
  .post("/issues/batch", ({ body, set }) => issue.batch({ body, set }), {
    body: t.Object({
      ids: t.Array(t.Integer()),
      action: t.Union([
        t.Literal("resolve"),
        t.Literal("unresolve"),
        t.Literal("ignore"),
        t.Literal("seen"),
        t.Literal("delete"),
      ]),
      ignoreUntil: t.Optional(t.Number()),
    }),
  })
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
        ignoreUntil: t.Optional(t.Number()),
      }),
    },
  )
  .post("/issues/:id/seen", ({ params }) => issue.seen({ params }))
  .post("/issues/:id/assign", ({ params, body, set }) => issue.assign({ params, body, set }), {
    body: t.Object({ assignedTo: t.Optional(t.Union([t.String(), t.Null()])) }),
  })
  .post("/issues/:id/merge", ({ params, body, set }) => issue.merge({ params, body, set }), {
    body: t.Object({ ids: t.Array(t.Integer()) }),
  })
  .post("/issues/:id/unmerge", ({ params, set }) => issue.unmerge({ params, set }))
  .delete("/issues/:id", ({ params, set }) => issue.remove({ params, set }));
