import { sql } from "drizzle-orm";
import { db } from "../db";
import { RETENTION_DAYS } from "../config";

/**
 * Retenção: apaga eventos/transactions antigos.
 * No Bun roda num setInterval (index.ts); na Cloudflare vira cron trigger (worker.ts).
 */
export async function runRetention(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  await db.run(sql`DELETE FROM events WHERE timestamp < ${cutoff}`);
  await db.run(sql`DELETE FROM transactions WHERE timestamp < ${cutoff}`);
}
