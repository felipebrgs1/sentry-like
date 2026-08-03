import type { HandlerContext } from "../controllers/types";
import { authenticateUser } from "../services/auth.service";
import type { DbUser } from "../services/user.service";

/**
 * Guard de autenticação para as rotas protegidas do dashboard.
 * Registrado diretamente em cada módulo de rotas com `.onBeforeHandle(authGuard)`
 * — padrão canônico do Elysia, determinístico (sem merge de plugins).
 * Aceita sessão OU API token (Bearer); anexa o usuário em ctx.store.user.
 */
export async function authGuard(ctx: Pick<HandlerContext, "request" | "set" | "store">) {
  const user = (await authenticateUser(ctx.request)) as DbUser | null;
  if (!user) {
    ctx.set.status = 401;
    return { error: "unauthorized" };
  }
  ctx.store.user = user;
}
