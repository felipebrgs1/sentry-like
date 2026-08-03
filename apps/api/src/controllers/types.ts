/** Contexto mínimo tipado que os handlers recebem do Elysia. */
export interface HandlerContext {
  params: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | undefined>;
  request: Request;
  set: { status?: number | string; headers?: unknown };
}
