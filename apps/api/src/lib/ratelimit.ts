import { RATE_LIMIT_PER_MIN } from "../config";

/**
 * Rate limit por projeto (janela deslizante em memória).
 * Quando estoura, o SDK do Sentry respeita o header X-Sentry-Rate-Limits
 * e para de enviar pelo tempo informado — igual ao comportamento do Sentry.
 */
const buckets = new Map<number, number[]>();
const WINDOW_MS = 60_000;

export function isRateLimited(projectId: number): boolean {
  const now = Date.now();
  const recent = (buckets.get(projectId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    buckets.set(projectId, recent);
    return true;
  }
  recent.push(now);
  buckets.set(projectId, recent);
  return false;
}

export const RATE_LIMIT_HEADER = "60000:error:project";
