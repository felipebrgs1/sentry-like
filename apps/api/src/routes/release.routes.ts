import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as release from "../controllers/release.controller";

export const releaseRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects/:id/releases", ({ params }) => release.list({ params }))
  .get(
    "/projects/:id/release-detail",
    ({ params, query, set }) => release.detail({ params, query, set }),
    {
      query: t.Object({ name: t.String() }),
    },
  )
  .get(
    "/projects/:id/releases-compare",
    ({ params, query, set }) => release.compare({ params, query, set }),
    {
      query: t.Object({ a: t.String(), b: t.String() }),
    },
  )
  .post("/projects/:id/releases", ({ params, body, set }) => release.mark({ params, body, set }), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      commits: t.Optional(t.Array(t.Any())),
      deployedAt: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
  })
  .get("/issues/:id/environments", ({ params }) => release.issueEnvironments({ params }))
  .get("/issues/:id/releases", ({ params }) => release.issueReleases({ params }));

/** Webhook de deploy — PÚBLICO (server-to-server, fora do authGuard). */
export const deployWebhookRoute = new Elysia().post("/v1/webhooks/releases/:projectId", (ctx) =>
  release.webhook(ctx),
);
