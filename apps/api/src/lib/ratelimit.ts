import { RATE_LIMIT_PER_MIN } from "../config";

/** Categorias de rate limit — o SDK do Sentry respeita cada uma no header. */
export type RateCategory =
  | "error"
  | "transaction"
  | "attachment"
  | "session"
  | "security"
  | "user_report";

const CATEGORY_KEY: Record<RateCategory, string> = {
  error: "error",
  transaction: "transaction",
  attachment: "attachment",
  session: "session",
  security: "security",
  user_report: "user_report",
};

const buckets = new Map<string, number[]>();
const WINDOW_MS = 60_000;

/**
 * Rate limit por projeto + categoria (janela deslizante em memória).
 * Quando estoura, o SDK respeita o header X-Sentry-Rate-Limits.
 */
export function isRateLimited(projectId: number, category: RateCategory): boolean {
  const now = Date.now();
  const key = `${projectId}:${CATEGORY_KEY[category]}`;
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}

/**
 * Monta o header X-Sentry-Rate-Limits a partir das categorias que JÁ foram
 * marcadas como limitadas (sem re-checar o bucket — não consome slots).
 * Formato Sentry: `retry_after_seconds:category:scope;...`
 */
export function rateLimitHeaders(categories: RateCategory[]): string {
  return categories.map((c) => `60000:${CATEGORY_KEY[c]}:project`).join(";");
}
