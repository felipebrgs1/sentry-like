import type { HandlerContext } from "./types";
import {
  bearerToken,
  checkCredentials,
  createSession,
  destroySession,
} from "../services/auth.service";
import { ensureBootstrap, needsSetup, setupOwner, toPublicUser } from "../services/user.service";

export async function login({
  body,
  set,
}: Pick<HandlerContext, "body" | "set"> & {
  body: { username: string; password: string; totpCode?: string };
}) {
  await ensureBootstrap();
  const user = await checkCredentials(body.username, body.password, body.totpCode);
  if (!user) {
    set.status = 401;
    return { error: "credenciais inválidas" };
  }
  return { token: await createSession(user.id), user: toPublicUser(user) };
}

export async function logout({ request }: Pick<HandlerContext, "request">) {
  await destroySession(bearerToken(request));
  return { ok: true };
}

export async function me({ store }: Pick<HandlerContext, "store">) {
  return { user: store.user ? toPublicUser(store.user) : null };
}

/** GET /v1/auth/setup-status — público: true se ainda não existe usuário */
export async function setupStatus() {
  await ensureBootstrap();
  return { needsSetup: await needsSetup() };
}

/** POST /v1/auth/setup — cria o primeiro usuário (owner) e já loga */
export async function setup({
  body,
  set,
}: Pick<HandlerContext, "body" | "set"> & {
  body: { name: string; email: string; password: string };
}) {
  await ensureBootstrap();
  const { name, email, password } = body ?? {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    set.status = 400;
    return { error: "name, email e senha (min 6) são obrigatórios" };
  }
  const user = await setupOwner({ name, email, password });
  if (!user) {
    set.status = 409;
    return { error: "setup já realizado" };
  }
  return { token: await createSession(user.id), user: toPublicUser(user) };
}
