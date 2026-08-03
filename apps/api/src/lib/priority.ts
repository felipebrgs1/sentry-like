import type { IssuePriority } from "@sentrylike/shared";

/**
 * Score de prioridade (heurística leve, estilo Sentry):
 * level × frequência × recência.
 * - level: fatal > error > warning > info > debug
 * - frequência: quantos eventos em relação ao teto (50)
 * - recência: decai com o tempo desde o último evento (1/2 a cada ~24h)
 */
const LEVEL_WEIGHT: Record<string, number> = {
  fatal: 1.0,
  error: 0.8,
  warning: 0.6,
  info: 0.4,
  debug: 0.2,
};

export function computePriority(
  level: string,
  eventCount: number,
  lastSeen: number,
  now = Date.now(),
): IssuePriority {
  const hours = Math.max(0, (now - lastSeen) / 3_600_000);
  const recency = 1 / (1 + hours / 24); // 1 agora, ~0.5 em 24h, ~0.17 em 5d
  const frequency = Math.min(eventCount, 50) / 50;
  const levelWeight = LEVEL_WEIGHT[level] ?? 0.5;

  const score = 0.35 * levelWeight + 0.35 * frequency + 0.3 * recency;
  if (score >= 0.65) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}
