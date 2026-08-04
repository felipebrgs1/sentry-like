import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Keyboard, Menu, Moon, Sun } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyTheme, type Theme } from "@/lib/theme";

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "g o", action: "Visão geral" },
  { keys: "g p", action: "Projetos" },
  { keys: "g i", action: "Issues (projetos)" },
  { keys: "g r", action: "Performance" },
  { keys: "g s", action: "Configurações" },
  { keys: "/", action: "Focar a busca de issues" },
  { keys: "?", action: "Mostrar estes atalhos" },
];

const CRUMB_LABELS: Record<string, string> = {
  projects: "Projetos",
  performance: "Performance",
  settings: "Configurações",
  issues: "Issue",
  replays: "Replay",
  alerts: "Alertas",
  releases: "Releases",
  sourcemaps: "Sourcemaps",
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    el.closest('[contenteditable="true"]') !== null
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  // fecha a nav mobile ao trocar de rota
  useEffect(() => setNavOpen(false), [location.pathname]);

  // atalhos de teclado (Fase 10)
  useEffect(() => {
    let gBuffer = 0; // timestamp da última tecla "g" (janela de 500ms)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (k === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sentrylike:focus-search"));
        return;
      }
      if (k === "g") {
        gBuffer = Date.now();
        return;
      }
      if (gBuffer && Date.now() - gBuffer < 500) {
        gBuffer = 0;
        const map: Record<string, string> = {
          o: "/",
          p: "/projects",
          i: "/projects",
          r: "/performance",
          s: "/settings",
        };
        const to = map[k];
        if (to) {
          e.preventDefault();
          navigate({ to });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const crumbs = location.pathname.split("/").filter(Boolean);

  return (
    <TooltipProvider>
      <AppSidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex min-h-screen flex-col md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-4" />
          </Button>
          <nav className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {crumbs.length === 0 ? (
              <span className="font-medium text-foreground">Visão geral</span>
            ) : (
              crumbs.map((seg, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground/50">/</span>}
                  <span
                    className={
                      i === crumbs.length - 1 ? "truncate font-medium text-foreground" : "truncate"
                    }
                  >
                    {CRUMB_LABELS[seg] ?? (seg.length > 12 ? `#${seg}` : seg)}
                  </span>
                </span>
              ))
            )}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setHelpOpen(true)}
              className="hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
              title="Atalhos de teclado (?)"
            >
              <Keyboard className="size-3.5" />
              <kbd className="font-mono">?</kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        <main
          key={location.pathname}
          className="animate-fade-up mx-auto w-full max-w-7xl flex-1 p-4 md:p-6"
        >
          <Outlet />
        </main>
      </div>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="w-80">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Keyboard className="size-4" /> Atalhos de teclado
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-2 px-4">
            {SHORTCUTS.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between rounded-lg border px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">{s.action}</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {s.keys}
                </kbd>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Atalhos com <kbd className="rounded border bg-muted px-1 font-mono">g</kbd> usam uma
              sequência rápida (ex.: pressione{" "}
              <kbd className="rounded border bg-muted px-1 font-mono">g</kbd> e depois{" "}
              <kbd className="rounded border bg-muted px-1 font-mono">o</kbd>).
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
