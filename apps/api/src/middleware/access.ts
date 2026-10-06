import type { HandlerContext } from "../controllers/types";
import { canAccessProject, projectIdOf, type ResourceKind } from "../services/access.service";
import { currentUser } from "./auth";

/**
 * Guard de autorização por recurso: resolve `params[param]` para o projeto
 * dono e checa se o usuário do request tem acesso. Usado como `beforeHandle`
 * por rota (depois do authGuard do módulo):
 *
 *   .get("/issues/:id", h, { beforeHandle: canAccess("issue") })
 *
 * Recurso inexistente OU de outro projeto → 404 (não vaza existência).
 */
export function canAccess(kind: ResourceKind, param = "id") {
  return async (ctx: Pick<HandlerContext, "params" | "request" | "set">) => {
    const id = ctx.params[param];
    const projectId = id ? await projectIdOf(kind, id) : null;
    if (projectId === null || !(await canAccessProject(currentUser(ctx.request), projectId))) {
      ctx.set.status = 404;
      return { error: "not found" };
    }
  };
}

/** Só owner (mutações de projeto, gestão de usuários). */
export function ownerOnly(ctx: Pick<HandlerContext, "request" | "set">) {
  if (!currentUser(ctx.request).isOwner) {
    ctx.set.status = 403;
    return { error: "owner only" };
  }
}
