import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2, Users } from "lucide-react";
import type { ApiToken, User } from "@sentrylike/shared";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function TwoFactor() {
  const qc = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/v1/auth/me"),
  });
  const enabled = me?.user?.totpEnabled === 1;

  const enable = useMutation({
    mutationFn: () =>
      api<{ secret: string; uri: string }>("/v1/auth/2fa/enable", { method: "POST" }),
    onSuccess: (d) => {
      setSecret(d.secret);
      setUri(d.uri);
      setMsg(null);
    },
  });

  const confirm = useMutation({
    mutationFn: () =>
      api("/v1/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) }),
    onSuccess: () => {
      setSecret(null);
      setUri(null);
      setCode("");
      setMsg("2FA ativado ✅");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setMsg("código inválido"),
  });

  const disable = useMutation({
    mutationFn: () =>
      api("/v1/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) }),
    onSuccess: () => {
      setCode("");
      setMsg("2FA desativado");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => setMsg("código inválido"),
  });

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4" /> Autenticação em dois fatores (TOTP)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {enabled ? (
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
              ativado
            </Badge>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="código do autenticador"
              className="w-40 font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={disable.isPending || code.length !== 6}
              onClick={() => disable.mutate()}
            >
              Desativar
            </Button>
          </div>
        ) : secret ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Adicione a chave no seu autenticador (Google Authenticator, Authy…) e confirme o
              código:
            </p>
            <code className="block overflow-x-auto rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs">
              {uri}
            </code>
            <code className="block font-mono text-sm">{secret}</code>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="código de 6 dígitos"
                className="w-40 font-mono"
              />
              <Button
                size="sm"
                disabled={confirm.isPending || code.length !== 6}
                onClick={() => confirm.mutate()}
              >
                Confirmar e ativar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={enable.isPending}
            onClick={() => enable.mutate()}
          >
            Ativar 2FA
          </Button>
        )}
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/v1/users"),
  });

  const create = useMutation({
    mutationFn: () =>
      api("/v1/users", {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      }),
    onSuccess: () => {
      setEmail("");
      setName("");
      setPassword("");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "falha ao criar"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/v1/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="size-4" /> Novo usuário
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="uemail">Email (login)</Label>
              <Input
                id="uemail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="dev@exemplo.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uname">Nome</Label>
              <Input
                id="uname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dev"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upass">Senha inicial</Label>
              <Input
                id="upass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="min 6 caracteres"
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={create.isPending || !email.trim() || !name.trim() || password.length < 6}
            onClick={() => create.mutate()}
          >
            Criar usuário
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell>
                    {u.isOwner === 1 ? (
                      <Badge variant="outline" className="text-primary">
                        owner
                      </Badge>
                    ) : (
                      <Badge variant="secondary">member</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      disabled={u.isOwner === 1 || remove.isPending}
                      onClick={() => {
                        if (confirm(`Remover ${u.name}?`)) remove.mutate(u.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!users && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TokensTab() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data: tokens } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api<ApiToken[]>("/v1/api-tokens"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ token: string }>("/v1/api-tokens", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (d) => {
      setNewToken(d.token);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api(`/v1/api-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  return (
    <div className="space-y-4">
      {newToken && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 text-sm">
            <p className="mb-1 font-medium">
              Guarde o token agora — ele não será mostrado de novo:
            </p>
            <code className="block overflow-x-auto rounded bg-muted/60 px-2 py-1.5 font-mono text-xs">
              {newToken}
            </code>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4" /> Novo token de API
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex.: CI do chatwoot"
            className="w-56"
          />
          <Button
            size="sm"
            disabled={create.isPending || !name.trim()}
            onClick={() => create.mutate()}
          >
            Gerar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Último uso</TableHead>
                <TableHead className="text-right">Criado</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString("pt-BR") : "nunca"}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm("Revogar este token?")) remove.mutate(t.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/v1/auth/me"),
  });
  const isOwner = me?.user?.isOwner === 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          {me?.user ? `${me.user.name} · ${me.user.email}` : ""}
        </p>
      </div>

      <Tabs defaultValue="perfil">
        <TabsList>
          <TabsTrigger value="perfil">Perfil & 2FA</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="tokens">API tokens</TabsTrigger>
        </TabsList>
        <TabsContent value="perfil" className="mt-4">
          <TwoFactor />
        </TabsContent>
        <TabsContent value="usuarios" className="mt-4">
          {isOwner ? (
            <UsersTab />
          ) : (
            <p className="text-sm text-muted-foreground">Somente o owner gerencia usuários.</p>
          )}
        </TabsContent>
        <TabsContent value="tokens" className="mt-4">
          <TokensTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
