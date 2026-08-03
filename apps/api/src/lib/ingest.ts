import { and, eq } from "drizzle-orm";
import type { SentryEvent } from "@sentrylike/shared";
import { db } from "../db";
import { events, issues } from "../db/schema";
import { computeFingerprint } from "./fingerprint";

/** Sentry timestamps can be epoch seconds or ISO strings. Normalize to ms. */
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
  return (event.message ?? event.logentry?.formatted ?? event.transaction ?? "Unknown event").slice(0, 500);
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
 * Stores one Sentry event, upserting the issue it groups into.
 * New occurrences of a resolved issue reopen it (Sentry "regression" behavior).
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
        status: "unresolved", // regression reopens
        title: existing.title || title,
        level,
        environment: event.environment ?? existing.environment,
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
      message: title,
      payload: JSON.stringify(event),
    })
    .onConflictDoNothing() // SDK retries send the same event_id
    .run();

  return id;
}
