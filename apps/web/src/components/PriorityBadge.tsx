import type { IssuePriority } from "@sentrylike/shared";
import { Badge } from "@/components/ui/badge";

const STYLE: Record<IssuePriority, string> = {
  high: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  low: "border-slate-500/40 bg-slate-500/10 text-slate-400",
};

const LABEL: Record<IssuePriority, string> = {
  high: "alta",
  medium: "média",
  low: "baixa",
};

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <Badge variant="outline" className={`shrink-0 font-medium ${STYLE[priority]}`}>
      {LABEL[priority]}
    </Badge>
  );
}
