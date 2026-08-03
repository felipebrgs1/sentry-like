import type { HandlerContext } from "./types";
import { MAX_ENVELOPE_BYTES } from "../config";
import { parseEnvelope } from "../lib/envelope";
import { isRateLimited, rateLimitHeaders, type RateCategory } from "../lib/ratelimit";
import { parseDsn, validateEvent } from "../lib/validate";
import { getAllowedDomains, getProject, getProjectByKey } from "../services/project.service";
import * as ingestService from "../services/ingest.service";
import type { Project, SentryEvent } from "@sentrylike/shared";

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

/** key pode vir no header X-Sentry-Auth, no Authorization ou na query (?sentry_key=). */
function extractSentryKey(request: Request): string | null {
  const fromHeader = request.headers.get("x-sentry-auth") ?? request.headers.get("authorization");
  const m = fromHeader?.match(/sentry_key=([a-f0-9]+)/i);
  if (m?.[1]) return m[1];
  const fromQuery = new URL(request.url).searchParams.get("sentry_key");
  return fromQuery ?? null;
}

function maybeDecompress(buf: Uint8Array, encoding: string | null): Uint8Array {
  if (encoding === "gzip") return Bun.gunzipSync(buf as Uint8Array<ArrayBuffer>);
  if (encoding === "deflate") return Bun.inflateSync(buf as Uint8Array<ArrayBuffer>);
  return buf;
}

async function readRawBody(request: Request, parsed: unknown): Promise<Uint8Array> {
  if (parsed instanceof Uint8Array) return parsed;
  if (typeof parsed === "string") return new TextEncoder().encode(parsed);
  return new Uint8Array(await request.arrayBuffer());
}

/** CORS por projeto: sem Origin (server-to-server) ou domínios vazios = liberado. */
function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.length === 0) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const hostname = host.replace(/^www\./, "");
  return allowed.some((d) => {
    if (d.startsWith("*.")) return hostname.endsWith(d.slice(1));
    return hostname === d || hostname === d.replace(/^www\./, "");
  });
}

/** Valida projeto, key do DSN e Origin. Preenche set.status em caso de erro. */
function guardProject(ctx: HandlerContext): Project | null {
  const project = getProject(Number(ctx.params.projectId));
  if (!project) {
    ctx.set.status = 404;
    return null;
  }
  const key = extractSentryKey(ctx.request);
  if (key && key !== project.publicKey) {
    ctx.set.status = 403;
    return null;
  }
  const origin = ctx.request.headers.get("origin");
  if (!originAllowed(origin, getAllowedDomains(project))) {
    ctx.set.status = 403;
    return null;
  }
  return project;
}

/** Injeta o contexto de trace a partir do header sentry-trace (pré-requisito da fase 4). */
function withTrace(event: SentryEvent, traceHeader: string | null): SentryEvent {
  if (!traceHeader) return event;
  const [traceId, spanId] = traceHeader.split("-");
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return event;
  return {
    ...event,
    contexts: {
      ...event.contexts,
      trace: {
        ...(event.contexts?.trace as Record<string, unknown>),
        trace_id: traceId,
        span_id: spanId ?? undefined,
      },
    },
  };
}

// ----------------------------------------------------------------
// processamento do envelope
// ----------------------------------------------------------------

interface ProcessResult {
  id: string | null;
  limitedCategories: RateCategory[];
}

async function processEnvelope(
  project: Project,
  raw: Uint8Array,
  traceHeader: string | null,
): Promise<ProcessResult> {
  const { header, items } = parseEnvelope(raw);
  const envelopeEventId = typeof header.event_id === "string" ? header.event_id : null;
  let lastEventId: string | null = null;
  const limitedCategories: RateCategory[] = [];

  const limited = (c: RateCategory): boolean => {
    if (isRateLimited(project.id, c)) {
      limitedCategories.push(c);
      return true;
    }
    return false;
  };

  for (const item of items) {
    const type = item.header.type ?? "";
    const text = new TextDecoder().decode(item.payload);
    switch (type) {
      case "event": {
        if (limited("error")) break;
        const res = validateEvent(JSON.parse(text));
        if (!res.ok) break; // malformado: descarta silenciosamente
        lastEventId = ingestService.storeEvent(project.id, withTrace(res.event, traceHeader));
        break;
      }
      case "transaction": {
        if (limited("transaction")) break;
        // fase 4: transactions ainda não são persistidas — só conta no rate limit
        const evt = JSON.parse(text) as { event_id?: string };
        lastEventId ??= evt.event_id ?? null;
        break;
      }
      case "attachment": {
        if (limited("attachment")) break;
        await ingestService.storeAttachment(project.id, envelopeEventId, item.header, item.payload);
        break;
      }
      case "session": {
        if (limited("session")) break;
        ingestService.storeSession(project.id, JSON.parse(text));
        break;
      }
      case "user_report": {
        if (limited("user_report")) break;
        ingestService.storeUserReport(project.id, JSON.parse(text));
        break;
      }
      case "replay_event":
      case "replay_recording": {
        await ingestService.storeReplay(project.id, type, item.header, item.payload);
        break;
      }
      case "client_report": {
        ingestService.storeClientReport(project.id, JSON.parse(text));
        break;
      }
      default:
        break; // security/profile/etc: ignora
    }
  }

  return { id: lastEventId, limitedCategories };
}

function rateLimitResponse(ctx: HandlerContext, projectId: number, categories: RateCategory[]) {
  ctx.set.status = 429;
  ctx.set.headers = { "x-sentry-rate-limits": rateLimitHeaders(categories) };
  return {};
}

// ----------------------------------------------------------------
// handlers
// ----------------------------------------------------------------

/** POST /api/:projectId/envelope/ — SDKs modernos */
export async function envelope(ctx: HandlerContext) {
  const project = guardProject(ctx);
  if (!project) return {};

  const raw = maybeDecompress(
    await readRawBody(ctx.request, ctx.body),
    ctx.request.headers.get("content-encoding"),
  );
  if (raw.byteLength > MAX_ENVELOPE_BYTES) {
    ctx.set.status = 413;
    return { detail: "envelope too large" };
  }

  try {
    const { id, limitedCategories } = await processEnvelope(
      project,
      raw,
      ctx.request.headers.get("sentry-trace"),
    );
    if (limitedCategories.length > 0) return rateLimitResponse(ctx, project.id, limitedCategories);
    return { id: id ?? "ignored" };
  } catch {
    ctx.set.status = 400;
    return { detail: "invalid envelope" };
  }
}

/** POST /api/:projectId/store/ — SDKs legados (corpo = evento JSON) */
export async function store(ctx: HandlerContext) {
  const project = guardProject(ctx);
  if (!project) return {};

  if (isRateLimited(project.id, "error")) {
    return rateLimitResponse(ctx, project.id, ["error"]);
  }

  try {
    const raw = maybeDecompress(
      await readRawBody(ctx.request, ctx.body),
      ctx.request.headers.get("content-encoding"),
    );
    const res = validateEvent(JSON.parse(new TextDecoder().decode(raw)));
    if (!res.ok) {
      ctx.set.status = 400;
      return { detail: res.error };
    }
    return { id: ingestService.storeEvent(project.id, res.event) };
  } catch {
    ctx.set.status = 400;
    return { detail: "invalid event" };
  }
}

/** POST /api/tunnel — SDKs de browser via proxy (anti ad-blocker). DSN vem no header do envelope. */
export async function tunnel(ctx: HandlerContext) {
  const raw = maybeDecompress(
    await readRawBody(ctx.request, ctx.body),
    ctx.request.headers.get("content-encoding"),
  );
  if (raw.byteLength > MAX_ENVELOPE_BYTES) {
    ctx.set.status = 413;
    return { detail: "envelope too large" };
  }

  try {
    const { header } = parseEnvelope(raw);
    const dsn = typeof header.dsn === "string" ? header.dsn : null;
    if (!dsn) {
      ctx.set.status = 403;
      return { detail: "missing DSN in envelope" };
    }
    const parsed = parseDsn(dsn);
    if (!parsed) {
      ctx.set.status = 403;
      return { detail: "invalid DSN" };
    }
    const project = getProjectByKey(parsed.publicKey);
    if (!project) {
      ctx.set.status = 403;
      return { detail: "unknown project" };
    }
    const origin = ctx.request.headers.get("origin");
    if (!originAllowed(origin, getAllowedDomains(project))) {
      ctx.set.status = 403;
      return { detail: "origin not allowed" };
    }

    const { id, limitedCategories } = await processEnvelope(
      project,
      raw,
      ctx.request.headers.get("sentry-trace"),
    );
    if (limitedCategories.length > 0) return rateLimitResponse(ctx, project.id, limitedCategories);
    return { id: id ?? "ignored" };
  } catch {
    ctx.set.status = 400;
    return { detail: "invalid envelope" };
  }
}
