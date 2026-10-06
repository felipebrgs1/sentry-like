import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { canAccess } from "../middleware/access";
import * as issue from "../controllers/issue.controller";

const issueAccess = { beforeHandle: canAccess("issue") };

export const issueRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/issues", ({ query, request }) => issue.recent({ query, request }))
  // rotas estáticas ANTES das parametrizadas (batch não pode virar ":id")
  .post("/issues/batch", ({ body, set, request }) => issue.batch({ body, set, request }), {
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
  .get("/issues/:id", ({ params, set }) => issue.get({ params, set }), issueAccess)
  .get("/issues/:id/events", ({ params }) => issue.events({ params }), issueAccess)
  .get("/issues/:id/stats", ({ params }) => issue.stats({ params }), issueAccess)
  .get("/events/:id", ({ params, set }) => issue.eventDetail({ params, set }), {
    beforeHandle: canAccess("event"),
  })
  .post(
    "/issues/:id/status",
    ({ params, body, set }) => issue.updateStatus({ params, body, set }),
    {
      ...issueAccess,
      body: t.Object({
        status: t.Union([t.Literal("unresolved"), t.Literal("resolved"), t.Literal("ignored")]),
        ignoreUntil: t.Optional(t.Number()),
      }),
    },
  )
  .post("/issues/:id/seen", ({ params }) => issue.seen({ params }), issueAccess)
  .post("/issues/:id/assign", ({ params, body, set }) => issue.assign({ params, body, set }), {
    ...issueAccess,
    body: t.Object({ assignedTo: t.Optional(t.Union([t.String(), t.Null()])) }),
  })
  .post(
    "/issues/:id/merge",
    ({ params, body, set, request }) => issue.merge({ params, body, set, request }),
    {
      ...issueAccess,
      body: t.Object({ ids: t.Array(t.Integer()) }),
    },
  )
  .post("/issues/:id/unmerge", ({ params, set }) => issue.unmerge({ params, set }), issueAccess)
  .delete("/issues/:id", ({ params, set }) => issue.remove({ params, set }), issueAccess);
