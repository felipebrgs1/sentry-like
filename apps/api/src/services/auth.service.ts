import { eq, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { SESSION_TTL_MS } from "../config";
import { authenticate, loginUser } from "./user.service";
import type { DbUser } from "./user.service";

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^bearer /i, "") ?? null;
}

/** Login por usuário do banco (PBKDF2 + TOTP opcional). Retorna usuário ou null. */
export async function checkCredentials(
  email: string,
  password: string,
  totpCode?: string,
): Promise<DbUser | null> {
  return loginUser(email, password, totpCode);
}

export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(sessions)
    .values({ token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  // limpeza oportunista de sessões expiradas
  await db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  return token;
}

/** Resolve o usuário por sessão OU por API token. */
export async function authenticateUser(request: Request): Promise<DbUser | null> {
  return authenticate(bearerToken(request));
}

export async function isSessionValid(token: string | null): Promise<boolean> {
  if (!token) return false;
  const row = await db.select().from(sessions).where(eq(sessions.token, token)).get();
  return !!row && row.expiresAt > Date.now();
}

export async function destroySession(token: string | null) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.token, token)).run();
}
