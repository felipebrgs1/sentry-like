import { eq, lt } from "drizzle-orm";
import { db } from "../db";
import { sessions } from "../db/schema";
import { ADMIN_PASSWORD, ADMIN_USER, SESSION_TTL_MS } from "../config";

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^bearer /i, "") ?? null;
}

export function checkCredentials(username: string, password: string): boolean {
  return username === ADMIN_USER && password === ADMIN_PASSWORD;
}

export function createSession(): string {
  const token = crypto.randomUUID();
  const now = Date.now();
  db.insert(sessions)
    .values({ token, createdAt: now, expiresAt: now + SESSION_TTL_MS })
    .run();
  // limpeza oportunista de sessões expiradas
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  return token;
}

export function isSessionValid(token: string | null): boolean {
  if (!token) return false;
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get();
  return !!row && row.expiresAt > Date.now();
}

export function destroySession(token: string | null) {
  if (!token) return;
  db.delete(sessions).where(eq(sessions.token, token)).run();
}
