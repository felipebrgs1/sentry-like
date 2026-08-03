import { desc, eq, sql } from "drizzle-orm";
import type {
  ReplayDetail,
  ReplayInteraction,
  ReplaySegment,
  ReplaySummary,
  RrwebEvent,
} from "@sentrylike/shared";
import { db } from "../db";
import { replayRecordings, replays } from "../db/schema";
import { deleteBlob, readBlob } from "../lib/storage";

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

/** Metadados vindos do payload do replay_event (urls, erros, user, início). */
function parseEventPayload(payload: string | null): {
  urls: string[];
  errorIds: string[];
  user: Record<string, unknown> | null;
  startTs: number | null;
} {
  if (!payload) return { urls: [], errorIds: [], user: null, startTs: null };
  try {
    const p = JSON.parse(payload) as {
      urls?: unknown;
      error_ids?: unknown;
      user?: unknown;
      replay_start_timestamp?: unknown;
    };
    return {
      urls: Array.isArray(p.urls)
        ? (p.urls as unknown[]).filter((u): u is string => typeof u === "string")
        : [],
      errorIds: Array.isArray(p.error_ids)
        ? (p.error_ids as unknown[]).filter((e): e is string => typeof e === "string")
        : [],
      user:
        typeof p.user === "object" && p.user !== null ? (p.user as Record<string, unknown>) : null,
      startTs:
        typeof p.replay_start_timestamp === "number"
          ? p.replay_start_timestamp < 1e12
            ? Math.round(p.replay_start_timestamp * 1000)
            : Math.round(p.replay_start_timestamp)
          : null,
    };
  } catch {
    return { urls: [], errorIds: [], user: null, startTs: null };
  }
}

// IncrementalSource do rrweb
const SRC_MOUSE_INTERACTION = 2;
const SRC_SCROLL = 3;
const SRC_INPUT = 5;
const MOUSE_CLICK = 2;

/** Extrai interações (clique/input/scroll) dos eventos, em ordem temporal. */
export function extractInteractions(events: RrwebEvent[]): ReplayInteraction[] {
  const out: ReplayInteraction[] = [];
  for (const e of events) {
    if (e.type !== 3) continue; // IncrementalSnapshot
    const d = e.data as {
      source?: number;
      type?: number;
      x?: number;
      y?: number;
      id?: number;
      text?: string;
    };
    if (d.source === SRC_MOUSE_INTERACTION && d.type === MOUSE_CLICK) {
      out.push({ timestamp: e.timestamp, kind: "click", x: d.x, y: d.y });
    } else if (d.source === SRC_INPUT) {
      out.push({
        timestamp: e.timestamp,
        kind: "input",
        target: d.id != null ? String(d.id) : undefined,
        value: typeof d.text === "string" ? d.text : undefined,
      });
    } else if (d.source === SRC_SCROLL) {
      out.push({ timestamp: e.timestamp, kind: "scroll" });
    }
  }
  return out;
}

/** Viewport declarado no primeiro evento Meta (rrweb). */
function extractViewport(events: RrwebEvent[]): { width: number; height: number } {
  for (const e of events) {
    if (e.type === 4) {
      const d = e.data as { width?: number; height?: number };
      if (typeof d.width === "number" && typeof d.height === "number") {
        return { width: d.width, height: d.height };
      }
    }
  }
  return { width: 800, height: 600 };
}

/** Duração: prioriza start_timestamp do replay_event; senão usa os eventos. */
function computeDuration(startTs: number | null, eventTs: number, events: RrwebEvent[]): number {
  if (startTs != null) return Math.max(0, eventTs - startTs);
  if (events.length > 1) {
    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    return Math.max(0, last - first);
  }
  return 0;
}

// ------------------------------------------------------------------
// API de leitura/escrita (controllers usam estas funções)
// ------------------------------------------------------------------

export async function listReplays(projectId: number): Promise<ReplaySummary[]> {
  const rows = await db
    .select({
      id: replays.id,
      projectId: replays.projectId,
      timestamp: replays.timestamp,
      release: replays.release,
      environment: replays.environment,
      payload: replays.payload,
      segmentCount: sql<number>`count(${replayRecordings.id})`,
    })
    .from(replays)
    .leftJoin(replayRecordings, eq(replayRecordings.replayId, replays.id))
    .where(eq(replays.projectId, projectId))
    .groupBy(replays.id)
    .orderBy(desc(replays.timestamp))
    .all();
  return rows.map((r) => {
    const meta = parseEventPayload(r.payload);
    return {
      id: r.id,
      projectId: r.projectId,
      timestamp: r.timestamp,
      durationMs: computeDuration(meta.startTs, r.timestamp, []),
      release: r.release,
      environment: r.environment,
      urls: meta.urls,
      errorIds: meta.errorIds,
      segmentCount: r.segmentCount,
    };
  });
}

/** Detalhe completo de um replay (metadados + segmentos decodificados). */
export async function getReplay(id: string): Promise<ReplayDetail | null> {
  const row = await db.select().from(replays).where(eq(replays.id, id)).get();
  if (!row) return null;

  const recs = await db
    .select()
    .from(replayRecordings)
    .where(eq(replayRecordings.replayId, id))
    .orderBy(replayRecordings.segmentId)
    .all();

  const segments: ReplaySegment[] = [];
  let eventCount = 0;
  for (const rec of recs) {
    const bytes = await readBlob(rec.storedPath);
    if (!bytes) continue;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        segments?: Array<{ tag?: string; data?: unknown }>;
      };
      const segEvents: RrwebEvent[] = Array.isArray(parsed.segments)
        ? parsed.segments
            .filter((s) => s?.tag === "event" && Array.isArray(s.data))
            .flatMap((s) => s.data as unknown[])
            .filter(
              (e): e is RrwebEvent =>
                typeof e === "object" &&
                e !== null &&
                typeof (e as RrwebEvent).timestamp === "number",
            )
        : [];
      segments.push({ segmentId: rec.segmentId, events: segEvents });
      eventCount += segEvents.length;
    } catch {
      // segmento corrompido — pula (não quebra o detalhe)
    }
  }

  const meta = parseEventPayload(row.payload);
  const events = segments.flatMap((s) => s.events).toSorted((a, b) => a.timestamp - b.timestamp);
  return {
    id: row.id,
    projectId: row.projectId,
    timestamp: row.timestamp,
    durationMs: computeDuration(meta.startTs, row.timestamp, events),
    release: row.release,
    environment: row.environment,
    urls: meta.urls,
    errorIds: meta.errorIds,
    segmentCount: recs.length,
    eventCount,
    user: meta.user,
    segments,
    interactions: extractInteractions(events),
    viewport: extractViewport(events),
  };
}

/** Apaga um replay (linha + segmentos + blobs em disco). */
export async function deleteReplay(id: string): Promise<boolean> {
  const row = await db.select().from(replays).where(eq(replays.id, id)).get();
  if (!row) return false;
  const recs = await db
    .select()
    .from(replayRecordings)
    .where(eq(replayRecordings.replayId, id))
    .all();
  for (const r of recs) await deleteBlob(r.storedPath).catch(() => {});
  await db.delete(replayRecordings).where(eq(replayRecordings.replayId, id)).run();
  await db.delete(replays).where(eq(replays.id, id)).run();
  return true;
}

/** Apaga todos os replays de um projeto (usado no deleteProject). */
export async function deleteProjectReplays(projectId: number): Promise<void> {
  const recs = await db
    .select()
    .from(replayRecordings)
    .where(eq(replayRecordings.projectId, projectId))
    .all();
  for (const r of recs) await deleteBlob(r.storedPath).catch(() => {});
  await db.delete(replayRecordings).where(eq(replayRecordings.projectId, projectId)).run();
  await db.delete(replays).where(eq(replays.projectId, projectId)).run();
}
