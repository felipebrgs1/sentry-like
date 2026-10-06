import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { canAccess, ownerOnly } from "../middleware/access";
import * as project from "../controllers/project.controller";

const projectAccess = { beforeHandle: canAccess("project") };
const ownerProjectAccess = { beforeHandle: [ownerOnly, canAccess("project")] };

export const projectRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects", ({ request }) => project.list({ request }))
  .post("/projects", ({ body }) => project.create({ body }), {
    beforeHandle: ownerOnly,
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
  })
  .get("/projects/:id", ({ params, request, set }) => project.get({ params, request, set }), {
    ...projectAccess,
  })
  .get("/projects/:id/issues", ({ params, query }) => project.issues({ params, query }), {
    ...projectAccess,
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
  .get(
    "/projects/:id/saved-searches",
    ({ params }) => project.savedSearches({ params }),
    projectAccess,
  )
  .post(
    "/projects/:id/saved-searches",
    ({ params, body, set }) => project.createSavedSearch({ params, body, set }),
    {
      ...projectAccess,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        filters: t.Record(t.String(), t.Optional(t.String())),
      }),
    },
  )
  .delete("/saved-searches/:id", ({ params, set }) => project.removeSavedSearch({ params, set }), {
    beforeHandle: canAccess("savedSearch"),
  })
  .get(
    "/projects/:id/environments",
    ({ params }) => project.environments({ params }),
    projectAccess,
  )
  .get("/projects/:id/releases", ({ params }) => project.releases({ params }), projectAccess)
  .patch("/projects/:id", ({ params, body, set }) => project.update({ params, body, set }), {
    ...ownerProjectAccess,
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      allowedDomains: t.Optional(t.Array(t.String())),
    }),
  })
  .post(
    "/projects/:id/rotate-key",
    ({ params, set }) => project.rotateKey({ params, set }),
    ownerProjectAccess,
  )
  .post(
    "/projects/:id/webhook-secret",
    ({ params, set }) => project.rotateWebhookSecret({ params, set }),
    ownerProjectAccess,
  )
  .delete(
    "/projects/:id",
    ({ params, set }) => project.remove({ params, set }),
    ownerProjectAccess,
  );
