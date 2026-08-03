# sentrylike

Error tracking compatível com SDKs do Sentry, sem Kafka, sem Java, sem 10 containers.
Uma VPS micro com 512MB de RAM roda isso tranquilo.

## Stack

- **Monorepo**: Turborepo (tasks) + workspaces (link de pacotes)
- **API**: Bun + Elysia, SQLite (`bun:sqlite` + Drizzle) — ingestão síncrona, sem fila
- **Web**: React 19 + TanStack Router/Query + Tailwind v4
- **Deploy**: 1 Dockerfile. Build do front é servido pela própria API.

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

Nos logs da API você verá o **ADMIN_USER/ADMIN_PASSWORD** (gerados se não setados) e a
**public key** do "Demo Project" seedado. Abra http://localhost:5173, entre com
usuário e senha, e copie o DSN do projeto.

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

## Usando com SDKs Sentry

```ts
// Node / Browser / qualquer SDK oficial
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: "https://<public_key>@errors.seudominio.com/1" });
```

## Config

| Env                 | Default              | Descrição                                |
| ------------------- | -------------------- | ---------------------------------------- |
| `PORT`              | `3000`               | Porta da API                             |
| `ADMIN_USER`        | `admin`              | Usuário do dashboard                     |
| `ADMIN_PASSWORD`    | gerada (ver logs)    | Senha do dashboard                       |
| `DATABASE_PATH`     | `sentrylike.db`      | Caminho do SQLite (`/data/...` no Docker) |
| `RETENTION_DAYS`    | `30`                 | Apaga eventos mais velhos que N dias     |
| `MAX_ENVELOPE_BYTES`| `10485760`           | Tamanho máx. de um envelope (10MB)       |

## Limitações conhecidas / roadmap

- Sem performance monitoring (transactions são ignoradas) — dá pra guardar como tabela separada
- Sem sourcemaps (stack traces minificados chegam minificados)
- Sem alertas/notificações (webhook ou email seria o próximo passo natural)
- Sem rate limiting por projeto (SDKs respeitariam `X-Sentry-Rate-Limits` se implementado)
- Multi-user: hoje é single-user com um token. Login de verdade = próxima feature
- Attachments são recebidos mas descartados
