import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bug, KeyRound, Sparkles, UserRound } from "lucide-react";
import { login, setToken } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  if (mode === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  const isSetup = mode === "setup";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bug className="size-5" />
          </div>
          <CardTitle>sentrylike</CardTitle>
          <CardDescription>
            {isSetup
              ? "Primeiro acesso — crie a conta de administrador"
              : "Entre com suas credenciais"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
  );
}
