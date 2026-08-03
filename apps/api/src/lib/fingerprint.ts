import type { SentryEvent } from "@sentrylike/shared";

/**
 * Groups events into issues, mimicking Sentry's default grouping:
 * exception type + the most significant stack frames.
 * Sentry frames arrive oldest-first, so the crashing frame is LAST.
 *
 * Se o SDK enviou `event.fingerprint` (array de strings), ele tem prioridade —
 * é o mecanismo oficial do Sentry para forçar agrupamento custom.
 *
 * Usa crypto.subtle (Web Crypto) — portável entre Bun e Cloudflare Workers.
 */
export async function computeFingerprint(event: SentryEvent): Promise<string> {
  if (event.fingerprint?.length) {
    return sha256(`fingerprint:${event.fingerprint.join("\u0000")}`);
  }

  const exc = event.exception?.values?.[0];
  const frames = exc?.stacktrace?.frames;

  if (frames?.length) {
    const inApp = frames.filter((f) => f.in_app);
    const significant = (inApp.length ? inApp : frames).slice(-5);
    const sig = significant
      .map((f) => `${f.function ?? "anon"}@${f.filename ?? f.abs_path ?? "?"}`)
      .join("|");
    return sha256(`${exc?.type ?? "Error"}:${sig}`);
  }

  const msg = event.message ?? event.logentry?.formatted ?? event.transaction ?? "unknown";
  return sha256(`message:${msg}`);
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
