import type { HandlerContext } from "./types";
import * as statsService from "../services/stats.service";
import { accessibleProjectIds } from "../services/access.service";
import { currentUser } from "../middleware/auth";

/** GET /v1/stats — visão geral do dashboard (só projetos visíveis ao usuário) */
export async function overview({ request }: Pick<HandlerContext, "request">) {
  return statsService.overview(await accessibleProjectIds(currentUser(request)));
}
