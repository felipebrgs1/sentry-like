import { Bug, CircleX, Info, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const CONFIG: Record<string, { icon: LucideIcon; cls: string }> = {
  fatal: { icon: CircleX, cls: "bg-red-500/15 text-red-400 border-red-500/40" },
  error: { icon: CircleX, cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  warning: { icon: TriangleAlert, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  info: { icon: Info, cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  debug: { icon: Bug, cls: "bg-muted text-muted-foreground border-border" },
};

export function LevelBadge({ level }: { level: string }) {
  const c = CONFIG[level] ?? CONFIG.debug;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={`shrink-0 gap-1 ${c.cls}`}>
      <Icon className="size-3" />
      {level}
    </Badge>
  );
}
