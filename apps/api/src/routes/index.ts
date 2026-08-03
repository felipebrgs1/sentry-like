import { Elysia } from "elysia";
import { ingestRoutes } from "./ingest.routes";
import { authPublicRoutes, authProtectedRoutes } from "./auth.routes";
import { statsRoutes } from "./stats.routes";
import { projectRoutes } from "./project.routes";
import { issueRoutes } from "./issue.routes";
import { performanceRoutes } from "./performance.routes";
import { alertRoutes } from "./alert.routes";
import { releaseRoutes, deployWebhookRoute } from "./release.routes";
import { sessionRoutes } from "./session.routes";

/** Monta todas as rotas da API. */
export const routes = new Elysia()
  .use(ingestRoutes)
  .use(authPublicRoutes)
  .use(authProtectedRoutes)
  .use(statsRoutes)
  .use(projectRoutes)
  .use(issueRoutes)
  .use(performanceRoutes)
  .use(alertRoutes)
  .use(releaseRoutes)
  .use(deployWebhookRoute)
  .use(sessionRoutes);
