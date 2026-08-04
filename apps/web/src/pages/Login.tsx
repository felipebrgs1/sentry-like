import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, Sparkles, UserRound } from "lucide-react";
import { login, setToken } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SentrylikeLogo } from "@/components/SentrylikeLogo";

/**
 * Login com onboarding: se ainda não existe nenhum usuário, mostra o
 * formulário de primeiro acesso (cria o owner). Depois disso, só login.
 */
export function LoginPage() {
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/v1/auth/setup-status")
      .then((r) => r.json())
      .then((d) => setMode(d?.needsSetup ? "setup" : "login"))
      .catch(() => setMode("login"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "setup") {
        const res = await fetch("/v1/auth/setup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email: username, password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "não foi possível criar o primeiro usuário");
        }
        const data = (await res.json()) as { token: string };
        setToken(data.token);
      } else {
        await login(username, password);
      }
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Usuário ou senha inválidos");
    } finally {
      setLoading(false);
    }
  }

  const isSetup = mode === "setup";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* fundo: glow violeta + grid sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 45% at 50% 0%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklch, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--foreground) 6%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
        }}
      />

      <div className="animate-fade-up relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_32px_-4px_var(--primary)]">
            <SentrylikeLogo size={26} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">sentrylike</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "loading"
                ? "Carregando…"
                : isSetup
                  ? "Primeiro acesso — crie a conta de administrador"
                  : "Error tracking minimalista, no seu servidor"}
            </p>
          </div>
        </div>

        {mode !== "loading" && (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl border bg-card/80 p-6 shadow-xl backdrop-blur-md"
          >
            {isSetup && (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <div className="relative">
                  <Sparkles className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    autoComplete="name"
                    className="pl-8"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">{isSetup ? "Email (login)" : "Usuário"}</Label>
              <div className="relative">
                <UserRound className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={isSetup ? "voce@exemplo.com" : "admin"}
                  autoComplete="username"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <KeyRound className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetup ? "mínimo 6 caracteres" : "••••••••"}
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  className="pl-8"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                loading ||
                !username ||
                !password ||
                (isSetup && (!name.trim() || password.length < 6))
              }
            >
              {loading ? "Aguarde…" : isSetup ? "Criar conta e entrar" : "Entrar"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          compatível com SDKs oficiais do Sentry
        </p>
      </div>
    </div>
  );
}
