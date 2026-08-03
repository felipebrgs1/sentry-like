import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as project from "../controllers/project.controller";

export const projectRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects", ({ request, store }) => project.list({ request, store }))
  .post("/projects", ({ body, store, set }) => project.create({ body, store, set }), {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
  })
  .get("/projects/:id", ({ params, request, set, store }) =>
    project.get({ params, request, set, store }),
  )
  .get("/projects/:id/issues", ({ params, query }) => project.issues({ params, query }), {
    query: t.Object({
      status: t.Optional(t.String()),
      q: t.Optional(t.String()),
      level: t.Optional(t.String()),
      env: t.Optional(t.String()),
      release: t.Optional(t.String()),
      cursor: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/saved-searches", ({ params }) => project.savedSearches({ params }))
  .post(
    "/projects/:id/saved-searches",
    ({ params, body, set }) => project.createSavedSearch({ params, body, set }),
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        filters: t.Record(t.String(), t.Optional(t.String())),
      }),
    },
  )
  .delete("/saved-searches/:id", ({ params, set }) => project.removeSavedSearch({ params, set }))
  .get("/projects/:id/environments", ({ params }) => project.environments({ params }))
  .get("/projects/:id/releases", ({ params }) => project.releases({ params }))
  .patch(
    "/projects/:id",
    ({ params, body, set, store }) => project.update({ params, body, set, store }),
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        allowedDomains: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .post("/projects/:id/rotate-key", ({ params, set, store }) =>
    project.rotateKey({ params, set, store }),
  )
  .delete("/projects/:id", ({ params, set, store }) => project.remove({ params, set, store }));
