import { eq, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { adminPassword, ADMIN_USER, SESSION_TTL_MS } from "../config";

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^bearer /i, "") ?? null;
}

export function checkCredentials(username: string, password: string): boolean {
  return username === ADMIN_USER && password === adminPassword();
}

export async function createSession(): Promise<string> {
  const token = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(sessions)
    .values({ token, createdAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  // limpeza oportunista de sessões expiradas
  await db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  return token;
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
