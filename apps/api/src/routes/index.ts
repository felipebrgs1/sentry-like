import { Elysia } from "elysia";
import { ingestRoutes } from "./ingest.routes";
import { authPublicRoutes, authProtectedRoutes } from "./auth.routes";
import { statsRoutes } from "./stats.routes";
import { projectRoutes } from "./project.routes";
import { issueRoutes } from "./issue.routes";
import { performanceRoutes } from "./performance.routes";

/** Monta todas as rotas da API. */
export const routes = new Elysia()
  .use(ingestRoutes)
  .use(authPublicRoutes)
  .use(authProtectedRoutes)
  .use(statsRoutes)
  .use(projectRoutes)
  .use(issueRoutes)
  .use(performanceRoutes);
