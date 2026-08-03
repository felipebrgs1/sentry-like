import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as project from "../controllers/project.controller";

export const projectRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects", project.list)
  .post("/projects", project.create, {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
  })
  .get("/projects/:id", project.get)
  .get("/projects/:id/issues", project.issues, {
    query: t.Object({
      status: t.Optional(t.String()),
      q: t.Optional(t.String()),
      level: t.Optional(t.String()),
      env: t.Optional(t.String()),
      release: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/environments", project.environments)
  .get("/projects/:id/releases", project.releases)
  .patch("/projects/:id", project.update, {
    body: t.Object({ name: t.String({ minLength: 1, maxLength: 120 }) }),
  })
  .post("/projects/:id/rotate-key", project.rotateKey)
  .delete("/projects/:id", project.remove);
