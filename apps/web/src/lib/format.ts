export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Estilo Sentry: "agora", "5m atrás", "2h atrás", "3d atrás", senão data completa. */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d atrás`;
  return fmtTime(ts);
}
