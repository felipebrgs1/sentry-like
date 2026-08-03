import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as session from "../controllers/session.controller";

export const sessionRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects/:id/crash-free", ({ params }) => session.crashFree({ params }))
  .get(
    "/projects/:id/crash-free-series",
    ({ params, query }) => session.crashFreeSeries({ params, query }),
    {
      query: t.Object({
        release: t.Optional(t.String()),
        days: t.Optional(t.String()),
      }),
    },
  )
  .get("/projects/:id/sessions", ({ params, query }) => session.sessions({ params, query }), {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })
  .get("/issues/:id/user-reports", ({ params }) => session.issueReports({ params }))
  .get(
    "/projects/:id/user-reports",
    ({ params, query }) => session.projectReports({ params, query }),
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
    },
  );
