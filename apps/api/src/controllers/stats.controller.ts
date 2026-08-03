import * as statsService from "../services/stats.service";

/** GET /v1/stats — visão geral do dashboard */
export async function overview() {
  return statsService.overview();
}
