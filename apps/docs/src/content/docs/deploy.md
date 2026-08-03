---
title: Deploy
description: VPS com Docker, Cloudflare Workers e o que observar em produção.
---

## Docker (VPS micro)

```bash
docker compose up -d --build
```

Um container na porta `3000`:

| Rota                    | Conteúdo                    |
| ----------------------- | --------------------------- |
| `/health`               | healthcheck (fetch simples) |
| `/api`, `/v1`, `/api/0` | API + ingestão              |
| `/`                     | SPA do dashboard            |
| `/docs`                 | esta documentação           |

O volume `sentrylike-data` guarda o SQLite (`/data/sentrylike.db`) e os blobs.

> `docker compose up` **não recria** quando a env muda via shell — use `--force-recreate` ou um `.env`.

## Cloudflare Workers

O `apps/api/src/worker.ts` é o entrypoint alternativo:

- **D1** — driver drizzle assíncrono (mesmo schema)
- **R2** — blobs (attachments/replays/sourcemaps)
- **KV** — rate limit compartilhado (opcional)
- **Static Assets** — serve o SPA
- **Cron** — retenção (diária) e alertas (a cada 5min)

A VPS continua o deploy default (`bun run start`).

## Produção

```bash
bun install
bun run build   # web (vite) + docs (astro) — a API roda TS direto no Bun
bun run start   # sobe a API servindo tudo
```

## Observabilidade

- `/health` → `{ "ok": true }`
- Logs no stdout (seed com a key, erros de ingestão)

## Recomendações

1. Defina `ADMIN_USER`/`ADMIN_PASSWORD` estáveis (senha gerada = difícil de recuperar depois)
2. Configure `APP_URL` para links corretos nos alertas
3. Backupe o volume (`/data`) — o roadmap prevê script de snapshot (VACUUM INTO) na fase de infra
4. Replays expiram em 7d por padrão; ajuste `REPLAY_RETENTION_DAYS` se necessário
