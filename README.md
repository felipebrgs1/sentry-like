# sentrylike

Error tracking compatível com SDKs do Sentry, sem Kafka, sem Java, sem 10 containers.
Uma VPS micro com 512MB de RAM roda isso tranquilo.

## Stack

- **Monorepo**: Turborepo (tasks) + workspaces (link de pacotes)
- **API**: Bun + Elysia, SQLite (`bun:sqlite` + Drizzle) — ingestão síncrona, sem fila
- **Web**: React 19 + TanStack Router/Query + Tailwind v4
- **Qualidade**: oxlint (lint) + oxfmt (format) — default no CLI e no editor
- **Deploy**: 1 Dockerfile. Build do front é servido pela própria API.

## Ferramentas (oxlint + oxfmt)

Lint e formatador do projeto Oxc — nativos, rápidos e o default em todo o código
(back e front).

```bash
bun run lint          # oxlint em todo o monorepo
bun run format        # formata tudo (apps, packages, scripts)
bun run format:check  # verifica se está formatado (CI)

# por app (via turbo)
bunx turbo lint
bunx turbo format:check
```

Configurações: `.oxlintrc.json` (lint) e `.oxfmtrc.json` (format). No editor,
instale a extensão **oxc.oxc-vscode** — o `.vscode/settings.json` já configura
oxfmt como formatador padrão (format on save) e oxlint no save.

### Plugins ativos

| Plugin       | O que pega                                               | Estado no projeto        |
| ------------ | -------------------------------------------------------- | ------------------------ |
| `react`      | hooks, JSX, estado (64 regras)                           | ✅ sem avisos            |
| `react-perf` | props/callback criados em todo render                    | ✅ sem avisos            |
| `jsx-a11y`   | acessibilidade (labels, autofocus, eventos de teclado)   | ✅ corrigido o que achou |
| `import`     | organização de imports ESM                               | ✅ sem avisos            |
| `promise`    | promises mal escritas (`new Promise` desnecessário etc.) | ✅ sem avisos            |
| `unicorn`    | estilo moderno (`.toReversed()` em vez de `.reverse()`)  | ✅ sem avisos            |
| `oxc`        | regras próprias do Oxc                                   | ✅ sem avisos            |
| `typescript` | uso correto de TS (110 regras)                           | ✅ sem avisos            |

O plugin `node` existe mas não está ativo: as regras úteis ficam na categoria
`restriction` (não roda por padrão) e `process.env` é intencional no `config.ts`.
Se quiser, ative com `-D node/no-process-env` em pontos específicos.

## Como funciona a compatibilidade com Sentry

Qualquer SDK oficial do Sentry funciona apontando o DSN para este servidor:

```
DSN:  http://<public_key>@<seu-host>/<project_id>
POST  /api/<project_id>/envelope/     ← SDKs modernos
POST  /api/<project_id>/store/        ← SDKs legados
```

Eventos são agrupados em **issues** por fingerprint (tipo da exceção + frames in-app),
igual ao comportamento padrão do Sentry. Issue resolvida que volta a ocorrer reabre (regressão).

## Dev

```bash
bun install
bun run dev          # API em :3001, web em :5173 (com proxy)
```

Sem usuários, o dashboard mostra o **onboarding** (crie o owner: nome/email/senha).
Abra http://localhost:5173, crie o primeiro usuário e copie o DSN do projeto.
(Deploy automatizado pode definir `ADMIN_USER`/`ADMIN_PASSWORD` no env — o owner é
criado no primeiro boot.)

Enviar um evento de teste sem SDK:

```bash
bun run demo:event "http://<public_key>@localhost:3001/1"
```

## Deploy (VPS)

```bash
docker build -t sentrylike .
docker run -d --name sentrylike \
  -p 3000:3000 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=troque-isso \
  -v sentrylike-data:/data \
  sentrylike
```

Ou `docker compose up -d`. Coloque um Caddy/nginx na frente para TLS.
Com TLS, o DSN vira `https://<key>@errors.seudominio.com/1`.

## Deploy (Cloudflare Workers — opcional)

Também roda na Cloudflare (D1 + R2 + KV + Static Assets), sem VPS:

```bash
wrangler login
bash deploy/cf-setup.sh   # cria D1/R2/KV, builda o front e faz deploy
```

Guia completo (incluindo integração Git sem build local): [`deploy/CF-DEPLOY.md`](deploy/CF-DEPLOY.md).

## Usando com SDKs Sentry

```ts
// Node / Browser / qualquer SDK oficial
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: "https://<public_key>@errors.seudominio.com/1" });
```

## Config

| Env                    | Default           | Descrição                                 |
| ---------------------- | ----------------- | ----------------------------------------- |
| `PORT`                 | `3000`            | Porta da API                              |
| `ADMIN_USER`/`ADMIN_PASSWORD` | (opcional) | Cria o owner automaticamente no 1º boot (docker/CI); sem isso, onboarding no front |
| `DATABASE_PATH`        | `sentrylike.db`   | Caminho do SQLite (`/data/...` no Docker) |
| `DATA_DIR`             | `./blobs`         | Anexos e replays em disco (junto do DB)   |
| `RETENTION_DAYS`       | `30`              | Apaga eventos mais velhos que N dias      |
| `MAX_ENVELOPE_BYTES`   | `10485760`        | Tamanho máx. de um envelope (10MB)        |
| `MAX_ATTACHMENT_BYTES` | `5242880`         | Tamanho máx. de um anexo (5MB)            |
| `RATE_LIMIT_PER_MIN`   | `600`             | Eventos/min/projeto por categoria         |

### Ingestão compatível com o protocolo Sentry

- `POST /api/:id/envelope/` — SDKs modernos (event, attachment, session, user_report, replay, client_report)
- `POST /api/:id/store/` — SDKs legados (com gzip/deflate)
- `POST /api/tunnel` — SDKs de browser via proxy (anti ad-blocker); o DSN vai no header do envelope
- Rate limiting por categoria com `X-Sentry-Rate-Limits` (SDKs respeitam e pausam o envio)
- `sentry-trace` capturado do header e persistido no `contexts.trace` do evento

## Limitações conhecidas / roadmap

Ver [roadmap.md](./roadmap.md) para o plano completo de evolução até 1:1 com o Sentry.

- Sem performance monitoring (transactions são ignoradas) — dá pra guardar como tabela separada
- Sem sourcemaps (stack traces minificados chegam minificados)
- Sem alertas/notificações (webhook ou email seria o próximo passo natural)
- Sem rate limiting por projeto (SDKs respeitariam `X-Sentry-Rate-Limits` se implementado)
- Multi-user: hoje é single-user com um token. Login de verdade = próxima feature
- Attachments são recebidos mas descartados
