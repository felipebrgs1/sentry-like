import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Bug, Keyboard, Moon, Sun } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [helpOpen, setHelpOpen] = useState(false);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

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

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bug className="size-4" />
              <span className="hidden sm:inline">sentrylike</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHelpOpen(true)}
                title="Atalhos de teclado (?)"
              >
                <Keyboard className="size-4" />
              </Button>
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
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>

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
                className="flex items-center justify-between rounded border px-3 py-2"
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
