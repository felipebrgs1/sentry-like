import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumn, Gauge, LayoutGrid, LogOut, Settings, X } from "lucide-react";
import type { ProjectWithStats, User } from "@sentrylike/shared";
import { api, logout } from "@/api";
import { cn } from "@/lib/utils";
import { SentrylikeLogo } from "./SentrylikeLogo";

/** Cor estável por projeto — dá identidade visual sem depender de avatar. */
const PROJECT_COLORS = [
  "bg-violet-400",
  "bg-pink-400",
  "bg-sky-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
];

function projectColor(id: number) {
  return PROJECT_COLORS[id % PROJECT_COLORS.length];
}

function NavItem({
  to,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  to: string;
  icon: typeof Gauge;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary/15 font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon className={cn("size-4", active && "text-primary")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const pathname = location.pathname;

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectWithStats[]>("/v1/projects"),
    refetchInterval: 30_000,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/v1/auth/me"),
  });

  async function handleLogout() {
    await logout();
    navigate({ to: "/login" });
  }

  return (
    <>
      {/* backdrop mobile */}
      {open && (
        <button
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r bg-panel transition-transform duration-200 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_16px_-4px_var(--primary)]">
            <SentrylikeLogo size={16} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">sentrylike</p>
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
              error tracking
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            aria-label="Fechar menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          <div className="space-y-0.5">
            <NavItem
              to="/"
              icon={ChartNoAxesColumn}
              label="Visão geral"
              active={pathname === "/"}
              onClick={onClose}
            />
            <NavItem
              to="/projects"
              icon={LayoutGrid}
              label="Projetos"
              active={pathname === "/projects"}
              onClick={onClose}
            />
            <NavItem
              to="/performance"
              icon={Gauge}
              label="Performance"
              active={pathname === "/performance"}
              onClick={onClose}
            />
          </div>

          <div>
            <p className="px-2.5 pb-1.5 text-[10px] font-medium tracking-widest text-muted-foreground/70 uppercase">
              Projetos
            </p>
            <div className="space-y-0.5">
              {projects?.map((p) => (
                <Link
                  key={p.id}
                  to="/projects/$projectId"
                  params={{ projectId: String(p.id) }}
                  onClick={onClose}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    pathname.startsWith(`/projects/${p.id}`)
                      ? "bg-primary/15 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity",
                      pathname.startsWith(`/projects/${p.id}`) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className={cn("size-2 shrink-0 rounded-full", projectColor(p.id))} />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
              {!projects?.length && (
                <p className="px-2.5 text-xs text-muted-foreground">sem projetos</p>
              )}
            </div>
          </div>
        </nav>

        <div className="space-y-0.5 border-t px-3 py-3">
          <Link
            to="/settings"
            onClick={onClose}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              pathname === "/settings"
                ? "bg-primary/15 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Settings className="size-4" />
            <span className="truncate">{me?.user?.name ?? "Configurações"}</span>
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <LogOut className="size-4" />
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}
