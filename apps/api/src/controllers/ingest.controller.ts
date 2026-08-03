import type { HandlerContext } from "./types";
import { MAX_ENVELOPE_BYTES } from "../config";
import { parseEnvelope } from "../lib/envelope";
import { isRateLimited, RATE_LIMIT_HEADER } from "../lib/ratelimit";
import type { Project } from "@sentrylike/shared";
import { getProject } from "../services/project.service";
import { storeEvent } from "../services/ingest.service";

function extractSentryKey(header: string | null): string | null {
  if (!header) return null;
  return header.match(/sentry_key=([a-f0-9]+)/i)?.[1] ?? null;
}

function maybeGunzip(buf: Uint8Array, encoding: string | null): Uint8Array {
  if (encoding === "gzip") return Bun.gunzipSync(buf as Uint8Array<ArrayBuffer>);
  return buf;
}

async function readRawBody(request: Request, parsed: unknown): Promise<Uint8Array> {
  if (parsed instanceof Uint8Array) return parsed;
  if (typeof parsed === "string") return new TextEncoder().encode(parsed);
  return new Uint8Array(await request.arrayBuffer());
}

/** Valida projeto, key e rate limit. Preenche set.status em caso de erro. */
function guardProject(
  projectId: number,
  authHeader: string | null,
  set: HandlerContext["set"],
): Project | null {
  const project = getProject(projectId);
  if (!project) {
    set.status = 404;
    return null;
  }
  const key = extractSentryKey(authHeader);
  if (key && key !== project.publicKey) {
    set.status = 403;
    return null;
  }
  if (isRateLimited(project.id)) {
    set.status = 429;
    set.headers = { "x-sentry-rate-limits": RATE_LIMIT_HEADER };
    return null;
  }
  return project;
}

/** POST /api/:projectId/envelope/ — SDKs modernos */
export async function envelope({ params, request, body, set }: HandlerContext) {
  const project = guardProject(
    Number(params.projectId),
    request.headers.get("x-sentry-auth") ?? request.headers.get("authorization"),
    set,
  );
  if (!project) return {};

  const raw = maybeGunzip(
    await readRawBody(request, body),
    request.headers.get("content-encoding"),
  );
  if (raw.byteLength > MAX_ENVELOPE_BYTES) {
    set.status = 413;
    return { detail: "envelope too large" };
  }

  let lastEventId: string | null = null;
  try {
    const { items } = parseEnvelope(raw);
    for (const item of items) {
      if (item.header.type !== "event") continue; // attachments/sessions/etc: ignora
      const event = JSON.parse(new TextDecoder().decode(item.payload)) as Parameters<typeof storeEvent>[1];
      lastEventId = storeEvent(project.id, event);
    }
  } catch {
    set.status = 400;
    return { detail: "invalid envelope" };
  }

  return { id: lastEventId ?? "ignored" };
}

/** POST /api/:projectId/store/ — SDKs legados */
export async function store({ params, request, body, set }: HandlerContext) {
  const project = guardProject(
    Number(params.projectId),
    request.headers.get("x-sentry-auth") ?? request.headers.get("authorization"),
    set,
  );
  if (!project) return {};

  try {
    const raw = maybeGunzip(
      await readRawBody(request, body),
      request.headers.get("content-encoding"),
    );
    const event = JSON.parse(new TextDecoder().decode(raw)) as Parameters<typeof storeEvent>[1];
    return { id: storeEvent(project.id, event) };
  } catch {
    set.status = 400;
    return { detail: "invalid event" };
  }
}
