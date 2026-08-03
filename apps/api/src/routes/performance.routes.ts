import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import * as perf from "../controllers/performance.controller";

export const performanceRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/performance/summaries", ({ query }) => perf.global({ query }), {
    query: t.Object({ days: t.Optional(t.String()) }),
  })
  .get(
    "/projects/:id/transaction-summaries",
    ({ params, query }) => perf.summaries({ params, query }),
    {
      query: t.Object({
        release: t.Optional(t.String()),
        env: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
    },
  )
  .get("/projects/:id/transactions", ({ params, query }) => perf.list({ params, query }), {
    query: t.Object({
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/transaction-series", ({ params, query }) => perf.series({ params, query }), {
    query: t.Object({
      name: t.String(),
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
      days: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/web-vitals", ({ params, query }) => perf.vitals({ params, query }), {
    query: t.Object({
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
    }),
  })
  .get(
    "/projects/:id/release-performance",
    ({ params, query }) => perf.releases({ params, query }),
    {
      query: t.Object({
        release: t.Optional(t.String()),
        env: t.Optional(t.String()),
      }),
    },
  )
  .get("/transactions/:id", ({ params, set }) => perf.detail({ params, set }))
  .delete("/transactions/:id", ({ params, set }) => perf.removeOne({ params, set }))
  .delete(
    "/projects/:id/transactions",
    ({ params, query, set }) => perf.removeByName({ params, query, set }),
    {
      query: t.Object({ name: t.String({ minLength: 1 }) }),
    },
  );
