import type { HandlerContext } from "../controllers/types";
import { bearerToken, isSessionValid } from "../services/auth.service";

/**
 * Guard de autenticação para as rotas protegidas do dashboard.
 * Registrado diretamente em cada módulo de rotas com `.onBeforeHandle(authGuard)`
 * — padrão canônico do Elysia, determinístico (sem merge de plugins).
 */
export function authGuard({ request, set }: Pick<HandlerContext, "request" | "set">) {
  if (!isSessionValid(bearerToken(request))) {
    set.status = 401;
    return { error: "unauthorized" };
  }
}
