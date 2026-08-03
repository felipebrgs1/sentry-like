import * as statsService from "../services/stats.service";

/** GET /v1/stats — visão geral do dashboard */
export function overview() {
  return statsService.overview();
}
