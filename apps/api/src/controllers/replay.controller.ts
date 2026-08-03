import type { HandlerContext } from "./types";
import * as replayService from "../services/replay.service";

/** GET /v1/projects/:id/replays — lista replays do projeto (mais recentes primeiro). */
export async function list({ params }: Pick<HandlerContext, "params">) {
  return replayService.listReplays(Number(params.id));
}

/** GET /v1/replays/:id — detalhe com segmentos decodificados para o player. */
export async function detail({ params, set }: Pick<HandlerContext, "params" | "set">) {
  const replay = await replayService.getReplay(params.id);
  if (!replay) {
    set.status = 404;
    return { error: "not found" };
  }
  return replay;
}

/** DELETE /v1/replays/:id — apaga replay (linha + segmentos + blobs). */
export async function remove({ params, set }: Pick<HandlerContext, "params" | "set">) {
  if (!(await replayService.deleteReplay(params.id))) {
    set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}
