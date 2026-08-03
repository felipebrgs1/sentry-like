import { sql } from "drizzle-orm";
import { db } from "../db";
import { REPLAY_RETENTION_DAYS, RETENTION_DAYS } from "../config";
import { deleteBlob } from "./storage";

/**
 * Retenção: apaga eventos/transactions antigos (RETENTION_DAYS) e replays
 * antigos (REPLAY_RETENTION_DAYS=7 — diferencial F9: replay em SQLite é
 * inviável para períodos longos; decisão consciente de expirar em 7d).
 * No Bun roda num setInterval (index.ts); na Cloudflare vira cron (worker.ts).
 */
export async function runRetention(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
  await db.run(sql`DELETE FROM events WHERE timestamp < ${cutoff}`);
  await db.run(sql`DELETE FROM transactions WHERE timestamp < ${cutoff}`);

  // replays: limpa segmentos (blobs) + linhas com mais de 7 dias
  const replayCutoff = Date.now() - REPLAY_RETENTION_DAYS * 86400_000;
  const oldPaths = (await db.all(
    sql`SELECT r.stored_path FROM replay_recordings r
         WHERE r.replay_id IN (SELECT id FROM replays WHERE timestamp < ${replayCutoff})`,
  )) as Array<{ stored_path: string }>;
  for (const p of oldPaths) await deleteBlob(p.stored_path).catch(() => {});
  await db.run(
    sql`DELETE FROM replay_recordings
        WHERE replay_id IN (SELECT id FROM replays WHERE timestamp < ${replayCutoff})`,
  );
  await db.run(sql`DELETE FROM replays WHERE timestamp < ${replayCutoff}`);
}
