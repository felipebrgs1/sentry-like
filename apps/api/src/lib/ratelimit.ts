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

const WINDOW_MS = 60_000;

/**
 * RateLimiter: janela deslizante por projeto + categoria.
 * VPS → memória (Map). Cloudflare → KV (isolates efêmeros não mantêm estado).
 */
export interface RateLimiter {
  isLimited(projectId: number, category: RateCategory): Promise<boolean>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly limit: number = RATE_LIMIT_PER_MIN,
    private readonly now: () => number = Date.now,
  ) {}

  async isLimited(projectId: number, category: RateCategory): Promise<boolean> {
    const now = this.now();
    const key = `${projectId}:${CATEGORY_KEY[category]}`;
    const recent = (this.buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= this.limit) {
      this.buckets.set(key, recent);
      return true;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return false;
  }
}

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Bucket em KV (Cloudflare): contagem por minuto com expiração TTL. */
class KVRateLimiter implements RateLimiter {
  constructor(private readonly kv: KV) {}

  async isLimited(projectId: number, category: RateCategory): Promise<boolean> {
    const now = Date.now();
    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const key = `rl:${projectId}:${CATEGORY_KEY[category]}:${windowStart}`;
    const current = Number((await this.kv.get(key)) ?? "0");
    if (current >= RATE_LIMIT_PER_MIN) return true;
    await this.kv.put(key, String(current + 1), { expirationTtl: 120 });
    return false;
  }
}

let limiter: RateLimiter = new MemoryRateLimiter();

/** Troca o limiter (worker.ts da Cloudflare chama com o binding KV). */
export function setRateLimiter(l: RateLimiter) {
  limiter = l;
}

/** Cria um RateLimiter KV a partir do binding. */
export function kvRateLimiter(binding: unknown): RateLimiter {
  return new KVRateLimiter(binding as KV);
}

/** Rate limit por projeto + categoria (janela deslizante). */
export function isRateLimited(projectId: number, category: RateCategory): Promise<boolean> {
  return limiter.isLimited(projectId, category);
}

/**
 * Monta o header X-Sentry-Rate-Limits a partir das categorias que JÁ foram
 * marcadas como limitadas (sem re-checar o bucket — não consome slots).
 * Formato Sentry: `retry_after_seconds:category:scope;...`
 */
export function rateLimitHeaders(categories: RateCategory[]): string {
  return categories.map((c) => `60000:${CATEGORY_KEY[c]}:project`).join(";");
}
