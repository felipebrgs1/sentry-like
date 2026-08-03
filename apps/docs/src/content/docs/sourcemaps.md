---
title: Sourcemaps
description: Simbolize stacktraces minificados com upload pelo sentry-cli ou pelo dashboard.
---

O item mais difícil do roadmap — resolvido com um parser de sourcemap v3 (VLQ) **sem dependências**, rodando em Bun/Workers.

## Upload

Dois caminhos:

### sentry-cli (CI)

```bash
export SENTRY_URL=http://localhost:3001
export SENTRY_ORG=default          # slug da organização
export SENTRY_PROJECT="Demo Project"
export SENTRY_AUTH_TOKEN=<api-token>  # Configurações → API tokens
export SENTRY_RELEASE=web@1.0.0

sentry-cli sourcemaps upload --release "$SENTRY_RELEASE" ./dist
```

Endpoints compatíveis com o protocolo:

- `GET /api/0/organizations/:org/releases/:version/files/`
- `GET|POST|DELETE /api/0/projects/:org/:project/releases/:version/files/`

Autenticação por **API token** (`X-Auth-Token` ou Bearer) — **não** a key de DSN.

> `chunk-upload` responde `404` de propósito: o sentry-cli cai no upload individual (VPS micro, sem bucket de chunks).

### Dashboard

Aba **Sourcemaps** do projeto → informar a release → selecionar os arquivos (bundle + `.map`, base64).

## Resolução

Artefatos ficam em `sourcemap_files` por `(project, release, name)`; o conteúdo vai para o BlobStore. O lookup no stacktrace tenta:

1. artefato-fonte → comentário `sourceMappingURL` → map relativo
2. `nome.map` direto
3. por basename (browser envia URL completa, subimos path relativo)

Normaliza `~/`, URLs completas e query/hash; cache LRU em memória (mapas decodificados, até 32 entradas).

## Simbolização

- **No detalhe do evento** (`/v1/events/:id`): badge "original" + linha/coluna/função originais + código-fonte real (`sourcesContent`); a linha minificada fica como secundária
- **No fingerprint** (ingestão): frames simbolizados agrupam chunks diferentes na mesma issue (validado: `app.js` e `app.js?v=2` → 1 issue)

## Retenção

Sourcemaps seguem a retenção do projeto — apagados junto com o projeto (metadados + blobs em disco).
