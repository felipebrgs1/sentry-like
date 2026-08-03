import type { HandlerContext } from "./types";
import { ADMIN_USER } from "../config";
import {
  bearerToken,
  checkCredentials,
  createSession,
  destroySession,
} from "../services/auth.service";

export async function login({
  body,
  set,
}: Pick<HandlerContext, "body" | "set"> & { body: { username: string; password: string } }) {
  if (!checkCredentials(body.username, body.password)) {
    set.status = 401;
    return { error: "credenciais inválidas" };
  }
  return { token: await createSession(), user: ADMIN_USER };
}

export async function logout({ request }: Pick<HandlerContext, "request">) {
  await destroySession(bearerToken(request));
  return { ok: true };
}

export function me() {
  return { user: ADMIN_USER };
}
