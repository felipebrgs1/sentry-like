import type { SentryEvent } from "@sentrylike/shared";

const VALID_LEVELS = new Set(["fatal", "error", "warning", "info", "debug"]);

export type ValidateResult = { ok: true; event: SentryEvent } | { ok: false; error: string };

/** Validação leve de evento Sentry — rejeita lixo com mensagem descritiva. */
export function validateEvent(input: unknown): ValidateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "event must be a JSON object" };
  }

  const event = input as Record<string, unknown>;

  if (event.event_id !== undefined && typeof event.event_id !== "string") {
    return { ok: false, error: "event_id must be a string" };
  }

  const hasContent =
    event.message !== undefined ||
    event.logentry !== undefined ||
    event.exception !== undefined ||
    event.transaction !== undefined ||
    event.type !== undefined ||
    event.breadcrumbs !== undefined;

  if (!hasContent) {
    return { ok: false, error: "event has no message, exception, transaction or type" };
  }

  // exception.values precisa ser um array de objetos
  if (event.exception !== undefined) {
    const exc = event.exception as { values?: unknown };
    if (typeof exc !== "object" || exc === null) {
      return { ok: false, error: "exception must be an object" };
    }
    if (exc.values !== undefined && !Array.isArray(exc.values)) {
      return { ok: false, error: "exception.values must be an array" };
    }
  }

  // timestamp parseável
  if (event.timestamp !== undefined) {
    const ts = event.timestamp;
    const numeric =
      typeof ts === "number" ? ts : typeof ts === "string" ? Number(new Date(ts)) : NaN;
    if (Number.isNaN(numeric)) {
      return { ok: false, error: "timestamp is not a valid date" };
    }
  }

  // normaliza level
  const level = typeof event.level === "string" ? event.level.toLowerCase() : "error";
  const normalized: SentryEvent = {
    ...(event as SentryEvent),
    level: VALID_LEVELS.has(level) ? level : "error",
  };
  return { ok: true, event: normalized };
}

/** Extrai componentes de um DSN: scheme://key@host/path/projectId */
export function parseDsn(dsn: string): { publicKey: string; projectId: number } | null {
  const m = dsn.match(/^https?:\/\/([^@/]+)@[^/]+\/(?:[^/]+\/)*(\d+)$/);
  if (!m) return null;
  const publicKey = m[1];
  const projectId = Number(m[2]);
  if (!publicKey || !Number.isInteger(projectId)) return null;
  return { publicKey, projectId };
}
