import { Button as ButtonPrimitive } from "@base-ui/react/button";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const VARIANTS: Record<ButtonVariant, string> = {
  default:
    "border-transparent bg-primary text-primary-foreground shadow-[0_1px_10px_-2px_var(--primary)] hover:bg-primary/90 hover:shadow-[0_1px_16px_-2px_var(--primary)]",
  outline:
    "border-border bg-transparent hover:bg-muted/60 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70",
  ghost:
    "border-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
  destructive:
    "border-transparent bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:ring-destructive/30",
  link: "border-transparent text-primary underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-3",
  xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-1.5 px-4",
  icon: "size-8",
  "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-7 rounded-md",
  "icon-lg": "size-9",
};

function buttonVariants(opts?: { variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const { variant = "default", size = "default", className } = opts ?? {};
  return cn(
    "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={(state) =>
        buttonVariants({
          variant,
          size,
          className: typeof className === "function" ? className(state) : className,
        })
      }
      {...props}
    />
  );
}

export { Button, buttonVariants };
