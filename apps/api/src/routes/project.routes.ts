import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as project from "../controllers/project.controller";

export const projectRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects", ({ request }) => project.list({ request }))
  .post("/projects", ({ body }) => project.create({ body }), {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
  })
  .get("/projects/:id", ({ params, request, set }) => project.get({ params, request, set }))
  .get("/projects/:id/issues", ({ params, query }) => project.issues({ params, query }), {
    query: t.Object({
      status: t.Optional(t.String()),
      q: t.Optional(t.String()),
      level: t.Optional(t.String()),
      env: t.Optional(t.String()),
      release: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/environments", ({ params }) => project.environments({ params }))
  .get("/projects/:id/releases", ({ params }) => project.releases({ params }))
  .patch("/projects/:id", ({ params, body, set }) => project.update({ params, body, set }), {
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      allowedDomains: t.Optional(t.Array(t.String())),
    }),
  })
  .post("/projects/:id/rotate-key", ({ params, set }) => project.rotateKey({ params, set }))
  .delete("/projects/:id", ({ params, set }) => project.remove({ params, set }));
