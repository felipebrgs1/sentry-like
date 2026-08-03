import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  fatal: "bg-red-500/20 text-red-400 border-red-500/40",
  error: "bg-red-500/15 text-red-400 border-red-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  debug: "bg-muted text-muted-foreground border-border",
};

export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge variant="outline" className={STYLES[level] ?? STYLES.debug}>
      {level}
    </Badge>
  );
}
