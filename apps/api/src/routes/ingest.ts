import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects } from "../db/schema";
import { parseEnvelope } from "../lib/envelope";
import { storeEvent } from "../lib/ingest";
import { MAX_ENVELOPE_BYTES } from "../config";
import type { SentryEvent } from "@sentrylike/shared";

function findProject(projectId: number) {
  return db.select().from(projects).where(eq(projects.id, projectId)).get();
}

/** Extract sentry_key from `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=...` */
function extractSentryKey(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/sentry_key=([a-f0-9]+)/i);
  return match?.[1] ?? null;
}

function maybeGunzip(buf: Uint8Array, encoding: string | null): Uint8Array {
  if (encoding === "gzip") return Bun.gunzipSync(buf as Uint8Array<ArrayBuffer>);
  return buf;
}

async function readRawBody(request: Request, parsedBody: unknown): Promise<Uint8Array> {
  if (parsedBody instanceof Uint8Array) return parsedBody;
  if (typeof parsedBody === "string") return new TextEncoder().encode(parsedBody);
  return new Uint8Array(await request.arrayBuffer());
}

/**
 * Sentry ingestion endpoints. These are PUBLIC (authenticated by DSN key,
 * like Sentry itself) and CORS-open, since browser SDKs post cross-origin.
 */
export const ingestRoutes = new Elysia()
  // Modern SDKs: POST /api/:projectId/envelope/
  .post("/api/:projectId/envelope/", async ({ params, request, body, set }) => {
    const projectId = Number(params.projectId);
    const project = findProject(projectId);
    if (!project) {
      set.status = 404;
      return { detail: "unknown project" };
    }

    const key = extractSentryKey(
      request.headers.get("x-sentry-auth") ?? request.headers.get("authorization"),
    );
    if (key && key !== project.publicKey) {
      set.status = 403;
      return { detail: "invalid public key" };
    }

    const raw = maybeGunzip(
      await readRawBody(request, body),
      request.headers.get("content-encoding"),
    );
    if (raw.byteLength > MAX_ENVELOPE_BYTES) {
      set.status = 413;
      return { detail: "envelope too large" };
    }

    let accepted = 0;
    let lastEventId: string | null = null;
    try {
      const { items } = parseEnvelope(raw);
      for (const item of items) {
        if (item.header.type !== "event") continue; // sessions/attachments/etc: ignore
        const event = JSON.parse(new TextDecoder().decode(item.payload)) as SentryEvent;
        lastEventId = storeEvent(project.id, event);
        accepted++;
      }
    } catch {
      set.status = 400;
      return { detail: "invalid envelope" };
    }

      return { id: lastEventId ?? "ignored" };
    },
    { parse: "none" }, // keep body a raw stream; we parse the envelope ourselves
  )

  // Legacy SDKs: POST /api/:projectId/store/ (plain JSON body)
  .post("/api/:projectId/store/", async ({ params, request, body, set }) => {
    const projectId = Number(params.projectId);
    const project = findProject(projectId);
    if (!project) {
      set.status = 404;
      return { detail: "unknown project" };
    }

    const key = extractSentryKey(
      request.headers.get("x-sentry-auth") ?? request.headers.get("authorization"),
    );
    if (key && key !== project.publicKey) {
      set.status = 403;
      return { detail: "invalid public key" };
    }

    try {
      const event =
        body && typeof body === "object"
          ? (body as SentryEvent)
          : (JSON.parse(
              new TextDecoder().decode(
                maybeGunzip(
                  await readRawBody(request, body),
                  request.headers.get("content-encoding"),
                ),
              ),
            ) as SentryEvent);
      return { id: storeEvent(project.id, event) };
    } catch {
      set.status = 400;
      return { detail: "invalid event" };
    }
    },
    { parse: "none" },
  );
