import { and, eq } from "drizzle-orm";
import type { EnvelopeItemHeader, SentryEvent } from "@sentrylike/shared";
import { db } from "../db";
import {
  attachments,
  clientReports,
  events,
  issues,
  replayRecordings,
  replays,
  sentrySessions,
  spans,
  transactions,
  userReports,
} from "../db/schema";
import { computeFingerprint } from "../lib/fingerprint";
import { computePriority } from "../lib/priority";
import { saveBlob } from "../lib/storage";
import { fireIngestAlerts } from "./alert.service";
import { symbolizeForGrouping } from "./sourcemap.service";
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
 * Semântica de status (igual Sentry):
 * - resolved + evento novo → reabre com badge de regressão
 * - ignored (sem janela) + evento novo → continua ignorada
 * - ignored com janela expirada → reabre sem badge de regressão
 */
export async function storeEvent(projectId: number, event: SentryEvent): Promise<string> {
  // Fase 8: se a release tem sourcemaps, o fingerprint usa os frames
  // simbolizados — chunks minificados diferentes com a mesma origem agrupam
  // na mesma issue ("frames similares"). Nunca quebra a ingestão.
  const fingerprint = await computeFingerprint(await symbolizeForGrouping(projectId, event));
  const ts = normalizeTimestamp(event.timestamp);
  const now = Date.now();
  const title = eventTitle(event);
  const level = event.level ?? "error";
  const id = (event.event_id ?? crypto.randomUUID()).replace(/-/g, "");

  const existing = await db
    .select()
    .from(issues)
    .where(and(eq(issues.projectId, projectId), eq(issues.fingerprint, fingerprint)))
    .get();

  let issueId: number;
  if (existing) {
    const wasResolved = existing.status === "resolved";
    const ignoreExpired =
      existing.status === "ignored" && existing.ignoredUntil != null && existing.ignoredUntil < now;

    // ignore sem janela (ou janela ainda vigente) continua ignorada
    const staysIgnored = existing.status === "ignored" && !ignoreExpired;
    const nextStatus = staysIgnored ? "ignored" : "unresolved";

    await db
      .update(issues)
      .set({
        lastSeen: Math.max(existing.lastSeen, ts),
        eventCount: existing.eventCount + 1,
        status: nextStatus,
        // badge de regressão: reabriu depois de resolvida
        regressed: wasResolved ? 1 : existing.regressed,
        ignoredUntil: staysIgnored ? existing.ignoredUntil : null,
        title: existing.title || title,
        level,
        environment: event.environment ?? existing.environment,
        release: event.release ?? existing.release,
        priority: computePriority(
          level,
          existing.eventCount + 1,
          Math.max(existing.lastSeen, ts),
          now,
        ),
        unread: 1, // atividade nova
      })
      .where(eq(issues.id, existing.id))
      .run();
    issueId = existing.id;
    if (wasResolved) {
      // Fase 5: regressão → alerta
      try {
        await fireIngestAlerts(projectId, "regression", {
          id: existing.id,
          title: existing.title || title,
          level,
          lastSeen: ts,
        });
      } catch {
        // alerta não deve quebrar a ingestão
      }
    }
  } else {
    const row = await db
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
        priority: computePriority(level, 1, ts, now),
        unread: 1,
      })
      .returning({ id: issues.id })
      .get();
    issueId = row.id;
    // Fase 5: issue nova → alerta
    try {
      await fireIngestAlerts(projectId, "new_issue", { id: row.id, title, level, lastSeen: ts });
    } catch {
      // alerta não deve quebrar a ingestão
    }
  }

  await db
    .insert(events)
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
// Transactions / spans (Fase 4 — performance)
// ------------------------------------------------------------------

interface TransactionContext {
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  status?: string;
}

/** user.id do payload (id numérico ou string) — para presença aproximada. */
function userFrom(event: SentryEvent): string | null {
  const id = (event.user as { id?: unknown } | undefined)?.id;
  if (id == null || id === "") return null;
  return String(id).slice(0, 120);
}

function browserFrom(event: SentryEvent): string | null {
  const b = event.contexts?.browser as { name?: string; version?: string } | undefined;
  if (!b?.name) return null;
  return b.version ? `${b.name} ${b.version}` : b.name;
}

/**
 * Persiste uma transaction com seus spans (waterfall).
 * Timestamps do protocolo são segundos (float) — normaliza para ms.
 */
export async function storeTransaction(
  projectId: number,
  event: SentryEvent,
): Promise<string | null> {
  const id = (event.event_id ?? crypto.randomUUID()).replace(/-/g, "");
  const end = normalizeTimestamp(event.timestamp);
  const start = normalizeTimestamp(event.start_timestamp ?? event.timestamp);
  const duration = Math.max(0, Math.round(end - start));
  const trace = (event.contexts?.trace ?? {}) as TransactionContext;

  const measurements =
    event.measurements && Object.keys(event.measurements).length ? event.measurements : null;

  await db
    .insert(transactions)
    .values({
      id,
      projectId,
      name: (event.transaction ?? event.message ?? "unknown").slice(0, 300),
      timestamp: start,
      duration,
      status: event.type === "transaction" ? ((trace.status as string) ?? "ok") : "ok",
      release: event.release ?? null,
      environment: event.environment ?? null,
      platform: event.platform ?? null,
      browser: browserFrom(event),
      country:
        ((event.user as { geo?: { country_code?: string } } | undefined)?.geo?.country_code ??
          null) ||
        null,
      userId: userFrom(event),
      traceId: trace.trace_id ?? null,
      spanId: trace.span_id ?? null,
      parentSpanId: trace.parent_span_id ?? null,
      measurements: measurements ? JSON.stringify(measurements) : null,
      payload: JSON.stringify(event),
    })
    .onConflictDoNothing() // retry do SDK manda o mesmo event_id
    .run();

  const rootStart = start;
  const rootEnd = end;
  for (const s of event.spans ?? []) {
    const sStart = normalizeTimestamp(s.start_timestamp ?? s.timestamp);
    const sEnd = normalizeTimestamp(s.timestamp ?? s.start_timestamp);
    if (!s.span_id || (sStart === rootStart && sEnd === rootEnd)) continue; // span é a própria transaction
    await db
      .insert(spans)
      .values({
        id: s.span_id,
        transactionId: id,
        projectId,
        traceId: s.trace_id ?? trace.trace_id ?? null,
        parentSpanId: s.parent_span_id ?? null,
        op: s.op ?? null,
        description: s.description ?? null,
        startTimestamp: sStart,
        endTimestamp: sEnd,
        duration: Math.max(0, Math.round(sEnd - sStart)),
        status: s.status ?? null,
        payload: JSON.stringify(s),
      })
      .onConflictDoNothing()
      .run();
  }

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
export async function storeSession(projectId: number, payload: unknown): Promise<void> {
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
  await db
    .insert(sentrySessions)
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
export async function storeUserReport(projectId: number, payload: unknown): Promise<void> {
  const r = (payload ?? {}) as {
    event_id?: string;
    name?: string;
    email?: string;
    comments?: string;
    timestamp?: number;
  };
  if (!r.event_id) return;
  await db
    .insert(userReports)
    .values({
      // normaliza hífens igual ao storeEvent (events.id não tem hífens)
      eventId: r.event_id.replace(/-/g, ""),
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
    segment_id?: number;
    segments?: unknown;
  };
  const id = parsed.replay_id ?? crypto.randomUUID().replace(/-/g, "");
  const ts =
    typeof parsed.timestamp === "number"
      ? parsed.timestamp < 1e12
        ? Math.round(parsed.timestamp * 1000)
        : Math.round(parsed.timestamp)
      : Date.now();

  if (kind === "replay_event") {
    // metadados da sessão (urls/error_ids no payload) — upsert: o recording
    // pode ter chegado antes, e o SDK reenvia o event em batidas.
    await db
      .insert(replays)
      .values({
        id,
        projectId,
        timestamp: ts,
        release: parsed.release ?? null,
        environment: parsed.environment ?? null,
        kind,
        storedPath: null,
        payload: text,
      })
      .onConflictDoUpdate({
        target: replays.id,
        set: {
          timestamp: ts,
          release: parsed.release ?? null,
          environment: parsed.environment ?? null,
          payload: text,
        },
      })
      .run();
    return;
  }

  // replay_recording: cada item é um segmento com id incremental.
  // Garante a linha "replays" (caso o recording chegue antes do event).
  await db
    .insert(replays)
    .values({
      id,
      projectId,
      timestamp: ts,
      release: parsed.release ?? null,
      environment: parsed.environment ?? null,
      kind: "replay_event",
      storedPath: null,
      payload: null,
    })
    .onConflictDoNothing()
    .run();

  const segmentId = typeof parsed.segment_id === "number" ? parsed.segment_id : 0;
  const storedPath = await saveBlob(projectId, "replays", id, `${id}.${segmentId}.bin`, payload);
  await db
    .insert(replayRecordings)
    .values({
      projectId,
      replayId: id,
      segmentId,
      storedPath,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [replayRecordings.replayId, replayRecordings.segmentId],
      set: { storedPath, createdAt: Date.now() },
    })
    .run();
}

/** Client report: estatísticas de envio do SDK (para métricas futuras). */
export async function storeClientReport(projectId: number, payload: unknown): Promise<void> {
  const r = (payload ?? {}) as { timestamp?: number; discarded_events?: unknown };
  await db
    .insert(clientReports)
    .values({
      id: crypto.randomUUID().replace(/-/g, ""),
      projectId,
      timestamp: r.timestamp ? Math.round(r.timestamp * 1000) : Date.now(),
      discarded: JSON.stringify(r.discarded_events ?? []),
    })
    .run();
}
