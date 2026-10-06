import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { canAccess } from "../middleware/access";
import * as release from "../controllers/release.controller";

const projectAccess = { beforeHandle: canAccess("project") };
const issueAccess = { beforeHandle: canAccess("issue") };

export const releaseRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/projects/:id/releases", ({ params }) => release.list({ params }), projectAccess)
  .get(
    "/projects/:id/release-detail",
    ({ params, query, set }) => release.detail({ params, query, set }),
    {
      ...projectAccess,
      query: t.Object({ name: t.String() }),
    },
  )
  .get(
    "/projects/:id/releases-compare",
    ({ params, query, set }) => release.compare({ params, query, set }),
    {
      ...projectAccess,
      query: t.Object({ a: t.String(), b: t.String() }),
    },
  )
  .post("/projects/:id/releases", ({ params, body, set }) => release.mark({ params, body, set }), {
    ...projectAccess,
    body: t.Object({
      name: t.String({ minLength: 1 }),
      commits: t.Optional(t.Array(t.Any())),
      deployedAt: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
  })
  .get(
    "/issues/:id/environments",
    ({ params }) => release.issueEnvironments({ params }),
    issueAccess,
  )
  .get("/issues/:id/releases", ({ params }) => release.issueReleases({ params }), issueAccess);

/**
 * Webhook de deploy — PÚBLICO (server-to-server, fora do authGuard), autenticado
 * pelo segredo do projeto (HMAC do GitHub ou token do GitLab). parse: "none"
 * porque o HMAC é calculado sobre o corpo cru.
 */
export const deployWebhookRoute = new Elysia().post(
  "/v1/webhooks/releases/:projectId",
  ({ params, request, set }) => release.webhook({ params, request, set }),
  { parse: "none" },
);
