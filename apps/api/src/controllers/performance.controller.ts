import type { HandlerContext } from "./types";
import * as perfService from "../services/performance.service";

function filters(query?: Record<string, string | undefined>) {
  return {
    release: query?.release,
    env: query?.env,
    q: query?.q,
  };
}

/** GET /v1/performance/summaries — rotas de todos os projetos */
export async function global({ query }: Pick<HandlerContext, "query">) {
  const days = Math.min(Math.max(Number(query?.days ?? 7), 1), 90);
  return perfService.globalSummaries(days);
}

/** GET /v1/projects/:id/transaction-summaries */
export async function summaries({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.transactionSummaries(Number(params.id), filters(query));
}

/** GET /v1/projects/:id/transactions — recentes */
export async function list({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const limit = Math.min(Math.max(Number(query?.limit ?? 100), 1), 500);
  return perfService.recentTransactions(Number(params.id), filters(query), limit);
}

/** GET /v1/projects/:id/transaction-series?name=… */
export async function series({ params, query }: Pick<HandlerContext, "params" | "query">) {
  const days = Math.min(Math.max(Number(query?.days ?? 14), 1), 90);
  return perfService.transactionSeries(Number(params.id), query?.name ?? "", filters(query), days);
}

/** GET /v1/transactions/:id */
export async function detail({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const t = await perfService.getTransaction(params.id);
  if (!t) {
    set.status = 404;
    return { error: "not found" };
  }
  return t;
}

/** GET /v1/projects/:id/web-vitals */
export async function vitals({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.webVitals(Number(params.id), filters(query));
}

/** GET /v1/projects/:id/release-performance */
export async function releases({ params, query }: Pick<HandlerContext, "params" | "query">) {
  return perfService.releasePerformance(Number(params.id), filters(query));
}
