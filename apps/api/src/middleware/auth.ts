import type { HandlerContext } from "../controllers/types";
import { authenticateUser } from "../services/auth.service";
import type { DbUser } from "../services/user.service";

/**
 * Usuário autenticado POR REQUEST. NÃO usar `ctx.store` do Elysia: `store` é
 * estado global da app, compartilhado entre requests concorrentes — um request
 * podia enxergar o usuário de outro (bug já encontrado: member virando owner).
 */
const requestUsers = new WeakMap<Request, DbUser>();

/** Usuário do request atual (só existe depois do authGuard). */
export function currentUser(request: Request): DbUser {
  const user = requestUsers.get(request);
  if (!user) throw new Error("currentUser() chamado fora de rota protegida pelo authGuard");
  return user;
}

/**
 * Guard de autenticação para as rotas protegidas do dashboard.
 * Registrado diretamente em cada módulo de rotas com `.onBeforeHandle(authGuard)`
 * — padrão canônico do Elysia, determinístico (sem merge de plugins).
 * Aceita sessão OU API token (Bearer); associa o usuário ao request.
 */
export async function authGuard(ctx: Pick<HandlerContext, "request" | "set">) {
  const user = (await authenticateUser(ctx.request)) as DbUser | null;
  if (!user) {
    ctx.set.status = 401;
    return { error: "unauthorized" };
  }
  requestUsers.set(ctx.request, user);
}
