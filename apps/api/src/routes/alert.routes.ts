import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { canAccess } from "../middleware/access";
import * as alert from "../controllers/alert.controller";

export const alertRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects/:id/alert-rules", ({ params }) => alert.list({ params }), {
    beforeHandle: canAccess("project"),
  })
  .get("/projects/:id/alert-logs", ({ params, query }) => alert.logs({ params, query }), {
    beforeHandle: canAccess("project"),
    query: t.Object({ limit: t.Optional(t.String()) }),
  })
  .post(
    "/projects/:id/alert-rules",
    ({ params, body, set }) => alert.create({ params, body, set }),
    {
      beforeHandle: canAccess("project"),
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        type: t.Union([
          t.Literal("new_issue"),
          t.Literal("regression"),
          t.Literal("frequency_spike"),
          t.Literal("unresolved_age"),
          t.Literal("rate_limit"),
          t.Literal("daily_digest"),
        ]),
        config: t.Optional(t.Record(t.String(), t.Any())),
        webhookType: t.Union([t.Literal("generic"), t.Literal("slack"), t.Literal("discord")]),
        webhookUrl: t.String({ minLength: 1, maxLength: 500 }),
      }),
    },
  )
  .patch("/alerts/:id", ({ params, body, set }) => alert.update({ params, body, set }), {
    beforeHandle: canAccess("alert"),
    body: t.Object({
      name: t.Optional(t.String()),
      config: t.Optional(t.Record(t.String(), t.Any())),
      webhookType: t.Optional(
        t.Union([t.Literal("generic"), t.Literal("slack"), t.Literal("discord")]),
      ),
      webhookUrl: t.Optional(t.String()),
      enabled: t.Optional(t.Union([t.Literal(0), t.Literal(1)])),
    }),
  })
  .post("/alerts/:id/test", ({ params, set }) => alert.test({ params, set }), {
    beforeHandle: canAccess("alert"),
  })
  .delete("/alerts/:id", ({ params, set }) => alert.remove({ params, set }), {
    beforeHandle: canAccess("alert"),
  });
