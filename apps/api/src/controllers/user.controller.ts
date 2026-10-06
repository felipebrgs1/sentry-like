import type { HandlerContext } from "./types";
import * as userService from "../services/user.service";
import { currentUser } from "../middleware/auth";
import { generateTotpSecret, provisioningUri } from "../lib/totp";
import { totpLimiter } from "../lib/attempts";

/** Aplica o limitador de falhas a uma verificação (TOTP/senha atual). */
async function limited(
  ctx: Pick<HandlerContext, "set">,
  key: string,
  check: () => Promise<boolean>,
): Promise<"ok" | "invalid" | "blocked"> {
  const wait = totpLimiter.retryAfter(key);
  if (wait > 0) {
    ctx.set.status = 429;
    ctx.set.headers = { "retry-after": String(wait) };
    return "blocked";
  }
  if (!(await check())) {
    totpLimiter.fail(key);
    return "invalid";
  }
  totpLimiter.reset(key);
  return "ok";
}

const TOO_MANY = { error: "muitas tentativas — aguarde alguns minutos" };

function requireOwner(ctx: Pick<HandlerContext, "request" | "set">): boolean {
  if (!currentUser(ctx.request).isOwner) {
    ctx.set.status = 403;
    return false;
  }
  return true;
}

/** GET /v1/users — lista usuários (owner) */
export async function listUsers(ctx: Pick<HandlerContext, "request" | "set">) {
  if (!requireOwner(ctx)) return { error: "owner only" };
  const rows = await userService.listUsers();
  return rows.map(userService.toPublicUser);
}

/** POST /v1/users — cria usuário (owner) */
export async function createUser(
  ctx: Pick<HandlerContext, "request" | "set" | "body"> & {
    body: { email: string; name: string; password: string; isOwner?: number };
  },
) {
  if (!requireOwner(ctx)) return { error: "owner only" };
  const { email, name, password, isOwner } = ctx.body ?? {};
  if (!email?.trim() || !name?.trim() || !password || password.length < 6) {
    ctx.set.status = 400;
    return { error: "email, name e senha (min 6) são obrigatórios" };
  }
  const existing = await userService.getUserByEmail(email);
  if (existing) {
    ctx.set.status = 409;
    return { error: "email já cadastrado" };
  }
  return userService.toPublicUser(
    await userService.createUser({ email, name, password, isOwner: isOwner ? 1 : 0 }),
  );
}

/** DELETE /v1/users/:id — remove usuário (owner) */
export async function deleteUser(ctx: Pick<HandlerContext, "request" | "set" | "params">) {
  if (!requireOwner(ctx)) return { error: "owner only" };
  if (!(await userService.deleteUser(Number(ctx.params.id)))) {
    ctx.set.status = 400;
    return { error: "não foi possível deletar (owner não pode ser removido)" };
  }
  return { ok: true };
}

// ------------------------------------------------------------------
// API tokens
// ------------------------------------------------------------------

/** GET /v1/api-tokens — meus tokens */
export async function listTokens(ctx: Pick<HandlerContext, "request">) {
  return userService.listTokens(currentUser(ctx.request).id);
}

/** POST /v1/api-tokens — cria token (retorna o token UMA vez) */
export async function createToken(
  ctx: Pick<HandlerContext, "request" | "set" | "body"> & { body: { name?: string } },
) {
  const name = ctx.body?.name?.trim();
  if (!name) {
    ctx.set.status = 400;
    return { error: "name is required" };
  }
  return userService.createToken(currentUser(ctx.request).id, name);
}

/** DELETE /v1/api-tokens/:id */
export async function deleteToken(ctx: Pick<HandlerContext, "request" | "set" | "params">) {
  if (!(await userService.deleteToken(Number(ctx.params.id), currentUser(ctx.request).id))) {
    ctx.set.status = 404;
    return { error: "not found" };
  }
  return { ok: true };
}

// ------------------------------------------------------------------
// 2FA (TOTP)
// ------------------------------------------------------------------

/** POST /v1/auth/2fa/enable — gera segredo e URI */
export async function enable2fa(ctx: Pick<HandlerContext, "request">) {
  const user = currentUser(ctx.request);
  if (user.totpEnabled) return { error: "2FA já ativado" };
  const secret = generateTotpSecret();
  await userService.enableTotp(user.id, secret);
  return { secret, uri: provisioningUri(secret, user.email) };
}

/** POST /v1/auth/2fa/confirm — confirma o código e ativa */
export async function confirm2fa(
  ctx: Pick<HandlerContext, "request" | "set" | "body"> & { body: { code?: string } },
) {
  const user = currentUser(ctx.request);
  const res = await limited(ctx, `totp:${user.id}`, () =>
    userService.confirmTotp(user.id, ctx.body?.code ?? ""),
  );
  if (res === "blocked") return TOO_MANY;
  if (res === "invalid") {
    ctx.set.status = 400;
    return { error: "código inválido" };
  }
  return { ok: true };
}

/** POST /v1/auth/2fa/disable — desativa com código */
export async function disable2fa(
  ctx: Pick<HandlerContext, "request" | "set" | "body"> & { body: { code?: string } },
) {
  const user = currentUser(ctx.request);
  const res = await limited(ctx, `totp:${user.id}`, () =>
    userService.disableTotp(user.id, ctx.body?.code ?? ""),
  );
  if (res === "blocked") return TOO_MANY;
  if (res === "invalid") {
    ctx.set.status = 400;
    return { error: "código inválido" };
  }
  return { ok: true };
}

/** POST /v1/auth/change-password — troca a senha do usuário logado */
export async function changePassword(
  ctx: Pick<HandlerContext, "request" | "set" | "body"> & {
    body: { currentPassword: string; newPassword: string };
  },
) {
  const user = currentUser(ctx.request);
  const { currentPassword, newPassword } = ctx.body ?? {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    ctx.set.status = 400;
    return { error: "senha atual e nova (min 6) são obrigatórias" };
  }
  const res = await limited(ctx, `password:${user.id}`, () =>
    userService.changePassword(user.id, currentPassword, newPassword),
  );
  if (res === "blocked") return TOO_MANY;
  if (res === "invalid") {
    ctx.set.status = 400;
    return { error: "senha atual incorreta" };
  }
  return { ok: true };
}
