# AGENTS.md — guia para agentes de IA neste projeto

> Leia isto antes de mexer em qualquer coisa. O objetivo é 1:1 com o Sentry em **features**, não em **arquitetura**: sem Kafka, sem fila, sem broker — Bun + SQLite numa VPS micro.

---

## 1. Visão geral

- **sentrylike**: error tracking compatível com o protocolo do Sentry (SDKs oficiais funcionam apontando o DSN para cá).
- Monorepo **Turborepo** (tasks) + **workspaces do bun** (link de pacotes).
- Runtime: **Bun 1.3.x** em todo lugar (API, scripts, testes).
- SQLite com `bun:sqlite` + Drizzle — sem Postgres (por enquanto).
- Roadmap completo em `roadmap.md` (sempre consultar antes de adicionar feature).

## 2. Estrutura

```
apps/api/            # Backend Bun + Elysia (padrão MVC)
  src/
    index.ts         # bootstrap: CORS, health, static SPA, seed, retenção
    config.ts        # TODAS as env vars em um lugar (nome→uso)
    middleware/      # authGuard (função, não plugin!)
    controllers/     # lógica HTTP: parse, status codes, response (sem SQL)
    services/        # regras de negócio + queries Drizzle (sem HTTP)
    routes/          # só declaração: path + validação t.* + delega ao controller
    lib/             # utilitários puros: envelope, fingerprint, ratelimit, storage, validate, timeseries, sourcemap (VLQ)
    db/              # schema.ts (Drizzle) + index.ts (CREATE IF NOT EXISTS + ALTERs idempotentes)
apps/web/            # React 19 + TanStack Router (code-based) + TanStack Query
  src/
    router.tsx       # rotas code-based; layout pathless id: "_app" (obrigatório _)
    pages/           # 1 arquivo por rota (Overview, Projects, ProjectIssues, IssueDetail, Login)
    components/      # AppSidebar, AppLayout, BarChart, LevelBadge
    components/ui/   # design system próprio (base-ui + tailwind, SEM shadcn) — editar à vontade
    lib/             # format.ts (timeAgo/fmtTime), api.ts (fetch + token), theme.ts, replay.ts
apps/docs/           # documentação (Astro Starlight, base "/docs"; conteúdo em src/content/docs)
packages/shared/     # tipos do protocolo Sentry + tipos da API (consumido por api e web)
scripts/             # send-test-event.ts (demo, zero deps)
```

## 3. Comandos

```bash
bun install                  # instala
bun run dev                  # turbo dev: API :3001 + Vite :5173 (proxy /api e /v1 → :3001) + Astro :4321 (docs em /docs)
bun run build                # turbo build (web = vite; docs = astro; API roda TS direto no Bun)
bun run build:cf             # build + copia docs/dist → web/dist/docs (deploy Cloudflare Workers)
bun run typecheck            # tsc --noEmit (TypeScript 7)
bun run lint                 # oxlint (raiz = monorepo inteiro)
bun run format / format:check  # oxfmt
bun run start                # sobe a API em produção (serve o build do web)
bun run test                 # bun test --parallel (unit + integração; DB temp por arquivo)
bun run test:unit            # só os unitários (apps/api/test/unit)
bun run test:integration     # só os de integração (apps/api/test/integration)
bun run demo:event <dsn>     # envia evento de teste sem SDK
docker compose up -d --build # deploy (1 container; volume /data)
```

**Antes de terminar qualquer mudança**: `bun run lint && bun run format && bun run typecheck && bun run build`. Zero warnings de lint.

## 4. Arquitetura do backend (regras rígidas)

Padrão **MVC** — ninguém gosta de arquivo gigante de rotas:

```
routes/  →  controllers/  →  services/  →  db (Drizzle)
   │             │               │
 path + t.*   parse/status    regras + SQL
```

- **routes**: NUNCA têm lógica. Só `.get("/x", ({params}) => ctrl.fn({params}), { schema })`. Handlers NÃO são passados direto como referência — use arrow que desestrutura o contexto: `({ params }) => ctrl.fn({ params })` (robusto com inferência degradada do editor).
- **controllers**: recebem `Pick<HandlerContext, "params" | "query" | "body" | "request" | "set">` (tipo em `controllers/types.ts`). Tipam `body`/`params` manualmente. `set.status = 404` + retorna `{ error }`. Sem SQL.
- **services**: funções puras de acesso a dados e regras. Nunca tocam em `set`/`request`.
- **lib/**: helpers sem dependência de HTTP.
- **middleware/auth.ts**: `authGuard` é **função** registrada com `.onBeforeHandle(authGuard)` em cada módulo de rotas protegido. **NÃO** criar como plugin Elysia singleton — o `.use()` do Elysia MUTA a instância do plugin, e compartilhar entre módulos é não-determinístico (bug já encontrado). O guard usa `{ as: "scoped" }` quando for plugin; na prática usamos `.onBeforeHandle` direto (canônico).

## 5. Ingestão Sentry (a parte crítica)

Endpoints (públicos, autenticados pela key do DSN — como o Sentry):

- `POST /api/:projectId/envelope/` — SDKs modernos. **`{ parse: "none" }`** obrigatório (body vira stream cru; o controller lê `request.arrayBuffer()`).
- `POST /api/:projectId/store/` — SDKs legados (JSON; gzip/deflate raw).
- `POST /api/tunnel` — browser SDKs; **DSN completo no header do envelope** (`header.dsn`), projeto achado pela key.

Regras:

- key pode vir de `X-Sentry-Auth`, `Authorization` ou query `?sentry_key=` (os três existem no ecossistema).
- gzip → `Bun.gunzipSync`; deflate → `Bun.inflateSync` (**raw deflate**, RFC 1951 — NÃO zlib).
- Valide sempre com `validateEvent()` antes de persistir (400 com motivo).
- Rate limit por **categoria** (`isRateLimited(projectId, category)`), header `X-Sentry-Rate-Limits: 60000:error:project;...`. **NUNCA** re-cheque o bucket ao montar o header (consumia slots — bug já corrigido).
- Origin check: `allowed_domains` do projeto (JSON array; suporta `*.domínio`); sem Origin ou lista vazia = liberado.
- `sentry-trace` header → injetar em `contexts.trace` (pré-requisito da fase 4).
- Blobs (attachments/replays) → `lib/storage.ts` (`DATA_DIR`); metadados no SQLite.
- **Sourcemaps (Fase 8)**: `POST /v1/projects/:id/sourcemaps` (dashboard) ou protocolo do `sentry-cli` em `/api/0/organizations/:org/releases/:version/files/` (auth por API token — `X-Auth-Token` ou Bearer; **NÃO** key de DSN). `chunk-upload` retorna 404 de propósito para o sentry-cli cair no upload individual. Simbolização acontece na LEITURA (`/v1/events/:id`) e no fingerprint da ingestão (quando a release tem sourcemaps).
- **Replays (Fase 9)**: `replay_event` vira a linha de sessão (upsert em `replays` — o recording pode chegar antes); cada `replay_recording` vira um segmento em `replay_recordings` (idempotente por `(replay_id, segment_id)`, blob em disco). O player (`/replays/:id`) reconstitui o DOM dos eventos rrweb com sanitização — nada do SDK de terceiros é renderizado sem escape. Expiração em 7d no `runRetention`.

## 6. Frontend

- **TanStack Router code-based**: `router.tsx` declara `createRootRoute` → `createRoute` (layout pathless com **`id: "_app"`** — o id PRECISA começar com `_`, senão vira segmento de URL; já foi bug) → `addChildren`.
- `useParams({ from: "/_app/projects/$projectId" })` — o `from` usa o **id** da rota (com `/_app`).
- `Link to` usa o **full path** (`/projects/$projectId`, sem `/_app`).
- **Design system próprio** (remodel 2025): `components/ui/` são wrappers enxutos sobre `@base-ui/react` + tailwind — podem ser editados. Sem shadcn/cva/tw-animate-css. Variantes de Button/Badge/Tabs são maps de string simples. Popups (select/menu/tooltip) animam com `data-starting-style`/`data-ending-style` do base-ui. `asChild` NÃO existe no base-ui: usa `render={<Link/>}` ou estado controlado (sheet/dialog).
- `Select` do base-nova emite `string | null` no `onValueChange` — tratar com `(v) => setX(v ?? "")`.
- Queries com TanStack Query (`queryKey` por rota + filtros; `refetchInterval` para listas).
- Tema: dark-first violeta (tokens em `index.css`, incl. `--panel` da sidebar); light existe mas dark é a estrela. Sidebar custom em `AppSidebar.tsx` (dot colorido por projeto, rail w-60, overlay no mobile). `BarChart` é CSS puro (sem lib de gráfico — proposta leve).
- `lib/api.ts`: token no localStorage, 401 → redireciona `/login`.

## 7. Convenções de código

- **oxfmt** é o formatador (rodou em todo o repo): aspas duplas, 2 espaços, quebra de linha a ~100 col. Nunca desformate manualmente.
- **oxlint** com plugins ativos: `react`, `react-perf`, `import`, `promise`, `jsx-a11y`, `unicorn`, `oxc`, `typescript`. Zero warnings. Regras específicas:
  - `react-in-jsx-scope: off` (JSX transform moderno)
  - `import/no-unassigned-import` com allow `**/*.css` (padrão Vite)
  - `no-unused-vars` é erro — remova imports mortos
- TypeScript **7.0.2** (nativo). Avisos: **`baseUrl` foi removido** do tsconfig (paths relativos); TS7 valida side-effect imports (precisa de `vite-env.d.ts` com `/// <reference types="vite/client" />`).
- `web/tsconfig.json` usa `lib: ES2023` (para `toReversed()` etc.).
- Textos da UI em pt-BR. Código/comentários em inglês ou português, mas consistente com o arquivo.

## 8. Armadilhas conhecidas (já vividas — não repetir)

1. **Processos zumbis**: `A && B &` no shell deixa o bun órfão; portas ficam ocupadas com código VELHO servindo (parece não-determinismo!). Sempre `pkill -9 -f "bun src/index.ts"` antes de re-testar, e use portas novas para isolamento.
2. **Elysia `.use()` muta o plugin**: guard compartilhado entre módulos = não-determinístico. Use função + `.onBeforeHandle`.
3. **Elysia `set.headers`**: tipar como `unknown` no `HandlerContext` (o tipo `HTTPHeaders` não casa com `Record<string,string>`).
4. **`Bun.inflateSync`** é raw deflate.
5. **`docker compose up` não recria** quando a env muda via shell — `--force-recreate` ou `.env`.
6. **Drizzle bun-sqlite**: `.run()` retorna `void` nos tipos — use `.returning({id}).get()` para pegar o id.
7. **Seed do projeto demo** só roda quando o DB está vazio — a key antiga continua valendo após rebuild (pegar do `/v1/projects`, não dos logs).
8. Colunas novas em tabelas existentes: **sempre** adicionar o `ALTER TABLE ... ADD COLUMN` idempotente em `db/index.ts` (try/catch), senão DBs antigos quebram.

## 9. Testes (automáticos)

`bun test` (runner nativo, zero deps) com **isolamento por arquivo**: `bunfig.toml` → `[test] preload` cria um diretório temporário por processo (SQLite + blobs) e `--parallel` roda cada arquivo num processo próprio — nenhum teste enxerga dados de outro.

- **Unit** (`apps/api/test/unit/`): envelope, fingerprint, validate, ratelimit (janela com `now` injetável), priority, timeseries, password, totp (validação cruzada com implementação de referência do RFC 6238), sourcemap (VLQ), storage.
- **Integração** (`apps/api/test/integration/`): app Elysia in-process (`app.handle`, sem listen) com banco real; cobre ingestão (envelope/store/tunnel/gzip/rate limit HTTP/origin check), auth (login/2FA/tokens), projetos (rotate key, allowed_domains), issues (regressão, ignore com janela, merge, batch), performance, alertas (webhook local via `Bun.serve` + checks periódicos), sessões, replay e sourcemaps (sentry-cli).

Dicas: `bun test --parallel apps/api/test/unit` para um subconjunto; `-t "nome"` filtra por nome. Rodar `bun run lint && bun run format && bun run typecheck` antes de terminar.

Smoke tests manuais via curl (continuam úteis para cenário de deploy real):

```bash
# subir API isolada
pkill -9 -f "bun src/index.ts"; rm -f /tmp/t.db*
ADMIN_USER=admin ADMIN_PASSWORD=senha123 DATABASE_PATH=/tmp/t.db PORT=3999 bun apps/api/src/index.ts &
# login → token
curl -s -X POST -H "content-type: application/json" -d '{"username":"admin","password":"senha123"}' localhost:3999/v1/auth/login
# evento de teste
bun scripts/send-test-event.ts "http://<key>@localhost:3999/1"
```

Envelope mínimo (formato EXATO — 1 linha de header por item, `length` em bytes):

```
{ "event_id": "...", "dsn": "http://key@host/1" }
{ "type": "event", "content_type": "application/json", "length": 123 }
{ ...event JSON... }
```

## 10. Roadmap (resumo para decisões)

- Fase 1 (ingestão completa) ✅ — envelope multi-item, tunnel, gzip/deflate, rate limit por categoria, origin check, validação, client reports, sentry-trace.
- **Fase 2 🔜** — issues & grouping: fingerprint custom do SDK, ignorar com janela, regressão, merge, ações em lote, prioridade.
- Fase 3 — releases & environments. Fase 4 — performance (transactions). Fase 5 — alertas. Fase 6 — sessões/crash-free. Fase 7 — multi-usuário. Fase 8 — sourcemaps. Fase 9 — replays. Fase 10 — UI.

Detalhes e não-objetivos em `roadmap.md`. Ao adicionar feature: verifique se já está no roadmap e marque quando concluir.
