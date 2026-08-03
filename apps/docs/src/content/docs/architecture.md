---
title: Arquitetura
description: Monorepo, padrão MVC, armazenamento e o "porquê" de cada escolha.
---

## Monorepo

```
apps/api/            # Backend Bun + Elysia (padrão MVC)
  src/
    index.ts         # bootstrap: CORS, health, static SPA + docs, seed, retenção
    config.ts        # TODAS as env vars em um lugar
    middleware/      # authGuard (função, não plugin!)
    controllers/     # lógica HTTP: parse, status codes, response (sem SQL)
    services/        # regras de negócio + queries Drizzle (sem HTTP)
    routes/          # só declaração: path + validação t.* + delega ao controller
    lib/             # utilitários puros: envelope, fingerprint, ratelimit, storage, validate, timeseries, sourcemap (VLQ)
    db/              # schema.ts (Drizzle) + index.ts (CREATE IF NOT EXISTS + ALTERs idempotentes)
apps/web/            # React 19 + TanStack Router + TanStack Query
apps/docs/           # Astro Starlight (estas docs)
packages/shared/     # tipos do protocolo Sentry + tipos da API
scripts/             # send-test-event.ts (demo, zero deps)
```

## Regras rígidas do backend

```
routes  →  controllers  →  services  →  db (Drizzle)
   │             │               │
 path + t.*   parse/status    regras + SQL
```

- **routes**: nunca têm lógica
- **controllers**: tipam `body`/`params`, setam `set.status` + `{ error }`; sem SQL
- **services**: funções puras de acesso a dados; nunca tocam em `set`/`request`
- **lib/**: helpers sem dependência de HTTP

## Armazenamento

| Dado                                    | Onde                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| Eventos, issues, transactions, users... | SQLite (`bun:sqlite` + Drizzle)                         |
| Attachments, replays, sourcemaps        | BlobStore — disco (`DATA_DIR`) na VPS, R2 no Cloudflare |
| Rate limit por categoria                | buckets em memória/KV                                   |

## Deploy

- **VPS**: 1 container (Dockerfile), `bun run start` serve API + SPA + docs
- **Cloudflare Workers**: driver D1 assíncrono, R2 para blobs, KV para rate limit, Static Assets para o SPA, cron de retenção

## Armadilhas já vividas (vale registrar)

1. **Processos zumbis**: `A && B &` deixa bun órfão — sempre `pkill -9 -f "bun src/index.ts"` antes de re-testar
2. **Elysia `.use()` muta o plugin**: guards compartilhados = não-determinístico — use função + `.onBeforeHandle`
3. **`Bun.inflateSync`** é raw deflate (RFC 1951), não zlib
4. **Drizzle bun-sqlite**: `.run()` retorna `void` nos tipos — use `.returning({id}).get()`
5. Colunas novas: sempre `ALTER TABLE ... ADD COLUMN` idempotente em `db/index.ts`
