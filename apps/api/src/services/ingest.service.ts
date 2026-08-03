import { and, eq } from "drizzle-orm";
import type { EnvelopeItemHeader, SentryEvent } from "@sentrylike/shared";
import { db } from "../db";
import {
  attachments,
  clientReports,
  events,
  issues,
  replays,
  sentrySessions,
  userReports,
} from "../db/schema";
import { computeFingerprint } from "../lib/fingerprint";
import { saveBlob } from "../lib/storage";
import { MAX_ATTACHMENT_BYTES } from "../config";

/** Sentry timestamps podem ser epoch seconds ou ISO string. Normaliza para ms. */
function normalizeTimestamp(ts: SentryEvent["timestamp"]): number {
  if (typeof ts === "number") return ts < 1e12 ? Math.round(ts * 1000) : Math.round(ts);
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function eventTitle(event: SentryEvent): string {
  const exc = event.exception?.values?.[0];
  if (exc) return `${exc.type ?? "Error"}: ${exc.value ?? ""}`.trim().slice(0, 500) || "Error";
  return (event.message ?? event.logentry?.formatted ?? event.transaction ?? "Unknown event").slice(
    0,
    500,
  );
}

function eventCulprit(event: SentryEvent): string | null {
  if (event.culprit) return event.culprit;
  const frames = event.exception?.values?.[0]?.stacktrace?.frames;
  const last = frames?.[frames.length - 1];
  if (!last) return null;
  const fn = last.function ?? "anonymous";
  return last.filename ? `${fn} (${last.filename})` : fn;
}

/**
 * Grava um evento Sentry, agrupando na issue correspondente (upsert).
 * Nova ocorrência de issue resolvida/ignorada reabre (regressão).
 */
export function storeEvent(projectId: number, event: SentryEvent): string {
  const fingerprint = computeFingerprint(event);
  const ts = normalizeTimestamp(event.timestamp);
  const title = eventTitle(event);
  const level = event.level ?? "error";
  const id = (event.event_id ?? crypto.randomUUID()).replace(/-/g, "");

  const existing = db
    .select()
    .from(issues)
    .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
    .get();

  let issueId: number;
  if (existing) {
    db.update(issues)
      .set({
        lastSeen: Math.max(existing.lastSeen, ts),
        eventCount: existing.eventCount + 1,
        status: "unresolved", // regressão reabre
        title: existing.title || title,
        level,
        environment: event.environment ?? existing.environment,
        release: event.release ?? existing.release,
      })
      .where(eq(issues.id, existing.id))
      .run();
    issueId = existing.id;
  } else {
    const row = db
      .insert(issues)
      .values({
        projectId,
        fingerprint,
        title,
        culprit: eventCulprit(event),
        level,
        status: "unresolved",
        environment: event.environment ?? null,
        release: event.release ?? null,
        firstSeen: ts,
        lastSeen: ts,
        eventCount: 1,
      })
      .returning({ id: issues.id })
      .get();
    issueId = row.id;
  }

  db.insert(events)
    .values({
      id,
      projectId,
      issueId,
      timestamp: ts,
      level,
      environment: event.environment ?? null,
      release: event.release ?? null,
      message: title,
      payload: JSON.stringify(event),
    })
    .onConflictDoNothing() // retry do SDK manda o mesmo event_id
    .run();

  return id;
}

// ------------------------------------------------------------------
// Outros itens do envelope (Fase 1 do roadmap)
// ------------------------------------------------------------------

/** Attachment: salva o blob em disco e registra metadados. */
export async function storeAttachment(
  projectId: number,
  eventId: string | null,
  header: EnvelopeItemHeader,
  payload: Uint8Array,
): Promise<void> {
  if (payload.byteLength > MAX_ATTACHMENT_BYTES) return; // descarta anexo grande
  const name = header.filename ?? "attachment.bin";
  const id = crypto.randomUUID().replace(/-/g, "");
  const storedPath = await saveBlob(projectId, "attachments", eventId ?? id, name, payload);
  db.insert(attachments)
    .values({
      id,
      projectId,
      eventId,
      name,
      contentType: header.content_type ?? null,
      size: payload.byteLength,
      storedPath,
      createdAt: Date.now(),
    })
    .run();
}

function sessionTs(v?: number | string): number | null {
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : Number(new Date(v));
  return Number.isNaN(n) ? null : n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** Sessão (crash-free tracking): upsert por sid. */
export function storeSession(projectId: number, payload: unknown): void {
  const s = (payload ?? {}) as {
    sid?: string;
    started?: number | string;
    timestamp?: number | string;
    duration?: number;
    status?: string;
    errors?: number;
    did?: string;
    attrs?: { release?: string; environment?: string };
  };
  if (!s.sid) return;
  db.insert(sentrySessions)
    .values({
      sid: s.sid,
      projectId,
      release: s.attrs?.release ?? null,
      environment: s.attrs?.environment ?? null,
      started: sessionTs(s.started),
      timestamp: sessionTs(s.timestamp),
      duration: s.duration ?? null,
      status: s.status ?? null,
      errors: s.errors ?? 0,
      did: s.did ?? null,
      payload: JSON.stringify(payload),
    })
    .onConflictDoUpdate({
      target: sentrySessions.sid,
      set: {
        timestamp: sessionTs(s.timestamp),
        duration: s.duration ?? null,
        status: s.status ?? null,
        errors: s.errors ?? 0,
        payload: JSON.stringify(payload),
      },
    })
    .run();
}

/** User feedback (widget do Sentry): upsert por event_id. */
export function storeUserReport(projectId: number, payload: unknown): void {
  const r = (payload ?? {}) as {
    event_id?: string;
    name?: string;
    email?: string;
    comments?: string;
    timestamp?: number;
  };
  if (!r.event_id) return;
  db.insert(userReports)
    .values({
      eventId: r.event_id,
      projectId,
      name: r.name ?? null,
      email: r.email ?? null,
      comments: r.comments ?? null,
      timestamp: r.timestamp ? Math.round(r.timestamp * 1000) : Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

/** Replay: grava o evento (JSON) ou o recording (blob em disco). */
export async function storeReplay(
  projectId: number,
  kind: "replay_event" | "replay_recording",
  header: EnvelopeItemHeader,
  payload: Uint8Array,
): Promise<void> {
  const text = new TextDecoder().decode(payload);
  const parsed = JSON.parse(text) as {
    replay_id?: string;
    timestamp?: number | string;
    release?: string;
    environment?: string;
    segments?: unknown;
  };
  const id = parsed.replay_id ?? crypto.randomUUID().replace(/-/g, "");
  const ts =
    typeof parsed.timestamp === "number"
      ? parsed.timestamp < 1e12
        ? Math.round(parsed.timestamp * 1000)
        : Math.round(parsed.timestamp)
      : Date.now();

  let storedPath: string | null = null;
  let payloadJson: string | null = null;
  if (kind === "replay_recording") {
    storedPath = await saveBlob(projectId, "replays", id, `${id}.bin`, payload);
  } else {
    payloadJson = text;
  }

  db.insert(replays)
    .values({
      id,
      projectId,
      timestamp: ts,
      release: parsed.release ?? null,
      environment: parsed.environment ?? null,
      kind,
      storedPath,
      payload: payloadJson,
    })
    .onConflictDoNothing()
    .run();
}

/** Client report: estatísticas de envio do SDK (para métricas futuras). */
export function storeClientReport(projectId: number, payload: unknown): void {
  const r = (payload ?? {}) as { timestamp?: number; discarded_events?: unknown };
  db.insert(clientReports)
    .values({
      id: crypto.randomUUID().replace(/-/g, ""),
      projectId,
      timestamp: r.timestamp ? Math.round(r.timestamp * 1000) : Date.now(),
      discarded: JSON.stringify(r.discarded_events ?? []),
    })
    .run();
}
