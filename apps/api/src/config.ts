import { dirname, join } from "node:path";

export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_PATH = process.env.DATABASE_PATH ?? "sentrylike.db";
export const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 30);
export const TOKEN_WAS_GENERATED = !process.env.ADMIN_TOKEN;
export const MAX_ENVELOPE_BYTES = Number(process.env.MAX_ENVELOPE_BYTES ?? 10 * 1024 * 1024);
// limite de eventos/min/projeto antes de responder 429 com X-Sentry-Rate-Limits
export const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 600);

// blobs (attachments/replays) ficam em disco, junto do banco
export const DATA_DIR = process.env.DATA_DIR ?? join(dirname(DATABASE_PATH), "blobs");
export const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES ?? 5 * 1024 * 1024);

// Dashboard user (single-user mode)
export const ADMIN_USER = process.env.ADMIN_USER?.trim() || "admin";
export const PASSWORD_WAS_GENERATED = !process.env.ADMIN_PASSWORD?.trim();
// lazy + memoized: crypto.randomUUID é proibido em escopo global no Worker (só dentro de handler)
let cachedPassword: string | null = null;
export function adminPassword(): string {
  cachedPassword ??= process.env.ADMIN_PASSWORD?.trim() || crypto.randomUUID();
  return cachedPassword;
}
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 dias
