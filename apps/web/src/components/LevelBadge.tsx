const CONFIG: Record<string, { dot: string; text: string }> = {
  fatal: { dot: "bg-fuchsia-400", text: "text-fuchsia-400" },
  error: { dot: "bg-rose-400", text: "text-rose-400" },
  warning: { dot: "bg-amber-400", text: "text-amber-400" },
  info: { dot: "bg-sky-400", text: "text-sky-400" },
  debug: { dot: "bg-slate-400", text: "text-muted-foreground" },
};

/** Badge de nível no estilo Sentry: dot colorido + label. */
export function LevelBadge({ level }: { level: string }) {
  const c = CONFIG[level] ?? CONFIG.debug;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`size-1.5 rounded-full ${c.dot} shadow-[0_0_6px_0_currentColor]`} />
      {level}
    </span>
  );
}
