import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary/80",
  secondary: "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/70",
  destructive: "border-transparent bg-destructive/15 text-destructive [a]:hover:bg-destructive/25",
  outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
  ghost: "border-transparent hover:bg-muted hover:text-muted-foreground",
  link: "border-transparent text-primary underline-offset-4 hover:underline",
};

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
          VARIANTS[variant],
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "badge", variant },
  });
}

export { Badge };
