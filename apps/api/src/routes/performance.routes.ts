import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { canAccess } from "../middleware/access";
import * as perf from "../controllers/performance.controller";

const projectAccess = { beforeHandle: canAccess("project") };
const transactionAccess = { beforeHandle: canAccess("transaction") };

export const performanceRoutes = new Elysia({ prefix: "/v1" })
  .onBeforeHandle(authGuard)
  .get("/performance/summaries", ({ query, request }) => perf.global({ query, request }), {
    query: t.Object({ days: t.Optional(t.String()) }),
  })
  .get(
    "/projects/:id/transaction-summaries",
    ({ params, query }) => perf.summaries({ params, query }),
    {
      ...projectAccess,
      query: t.Object({
        release: t.Optional(t.String()),
        env: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
    },
  )
  .get("/projects/:id/transactions", ({ params, query }) => perf.list({ params, query }), {
    ...projectAccess,
    query: t.Object({
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/transaction-series", ({ params, query }) => perf.series({ params, query }), {
    ...projectAccess,
    query: t.Object({
      name: t.String(),
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
      days: t.Optional(t.String()),
    }),
  })
  .get("/projects/:id/web-vitals", ({ params, query }) => perf.vitals({ params, query }), {
    ...projectAccess,
    query: t.Object({
      release: t.Optional(t.String()),
      env: t.Optional(t.String()),
    }),
  })
  .get(
    "/projects/:id/release-performance",
    ({ params, query }) => perf.releases({ params, query }),
    {
      ...projectAccess,
      query: t.Object({
        release: t.Optional(t.String()),
        env: t.Optional(t.String()),
      }),
    },
  )
  .get("/transactions/:id", ({ params, set }) => perf.detail({ params, set }), transactionAccess)
  .delete(
    "/transactions/:id",
    ({ params, set }) => perf.removeOne({ params, set }),
    transactionAccess,
  )
  .delete(
    "/projects/:id/transactions",
    ({ params, query, set }) => perf.removeByName({ params, query, set }),
    {
      ...projectAccess,
      query: t.Object({ name: t.String({ minLength: 1 }) }),
    },
  );
