import { createHash } from "node:crypto";
import type { SentryEvent } from "@sentrylike/shared";

/**
 * Groups events into issues, mimicking Sentry's default grouping:
 * exception type + the most significant stack frames.
 * Sentry frames arrive oldest-first, so the crashing frame is LAST.
 */
export function computeFingerprint(event: SentryEvent): string {
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

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
