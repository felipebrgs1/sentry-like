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

/**
 * Decompression portável (Web Streams) — funciona em Bun e Cloudflare Workers.
 * `deflate` do Sentry é RAW (RFC 1951), então usamos "deflate-raw".
 * Fallback para Bun.gunzipSync/inflateSync caso o stream não suporte.
 */
async function maybeDecompress(buf: Uint8Array, encoding: string | null): Promise<Uint8Array> {
  if (!encoding) return buf;
  try {
    const format = encoding === "gzip" ? "gzip" : "deflate-raw";
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // VPS/Bun fallback (typeof guard para não quebrar no Worker)
    if (typeof Bun !== "undefined") {
      if (encoding === "gzip") return Bun.gunzipSync(buf as Uint8Array<ArrayBuffer>);
      return Bun.inflateSync(buf as Uint8Array<ArrayBuffer>);
    }
    throw new Error("unsupported content-encoding: " + encoding);
  }
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
async function guardProject(ctx: HandlerContext): Promise<Project | null> {
  const project = await getProject(Number(ctx.params.projectId));
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

  const limited = async (c: RateCategory): Promise<boolean> => {
    if (await isRateLimited(project.id, c)) {
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
        if (await limited("error")) break;
        const res = validateEvent(JSON.parse(text));
        if (!res.ok) break; // malformado: descarta silenciosamente
        lastEventId = await ingestService.storeEvent(project.id, withTrace(res.event, traceHeader));
        break;
      }
      case "transaction": {
        if (await limited("transaction")) break;
        // Fase 4: persiste transaction + spans para o waterfall/performance
        const evt = JSON.parse(text) as SentryEvent;
        const stored = await ingestService.storeTransaction(project.id, evt);
        lastEventId ??= stored ?? evt.event_id ?? null;
        break;
      }
      case "attachment": {
        if (await limited("attachment")) break;
        await ingestService.storeAttachment(project.id, envelopeEventId, item.header, item.payload);
        break;
      }
      case "session": {
        if (await limited("session")) break;
        ingestService.storeSession(project.id, JSON.parse(text));
        break;
      }
      case "user_report": {
        if (await limited("user_report")) break;
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
  const project = await guardProject(ctx);
  if (!project) return {};

  const raw = await maybeDecompress(
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
  const project = await guardProject(ctx);
  if (!project) return {};

  if (await isRateLimited(project.id, "error")) {
    return rateLimitResponse(ctx, project.id, ["error"]);
  }

  try {
    const raw = await maybeDecompress(
      await readRawBody(ctx.request, ctx.body),
      ctx.request.headers.get("content-encoding"),
    );
    const res = validateEvent(JSON.parse(new TextDecoder().decode(raw)));
    if (!res.ok) {
      ctx.set.status = 400;
      return { detail: res.error };
    }
    // SDKs que enviam transactions pelo /store/ legado
    if (res.event.type === "transaction") {
      return { id: (await ingestService.storeTransaction(project.id, res.event)) ?? "ignored" };
    }
    return { id: await ingestService.storeEvent(project.id, res.event) };
  } catch {
    ctx.set.status = 400;
    return { detail: "invalid event" };
  }
}

/** POST /api/tunnel — SDKs de browser via proxy (anti ad-blocker). DSN vem no header do envelope. */
export async function tunnel(ctx: HandlerContext) {
  const raw = await maybeDecompress(
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
    const project = await getProjectByKey(parsed.publicKey);
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
