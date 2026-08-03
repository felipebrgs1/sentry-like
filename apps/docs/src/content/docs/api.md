---
title: API
description: Endpoints principais do dashboard (v1) e de ingestão (v1/api).
---

Todas as rotas `/v1` exigem autenticação (sessão ou API token Bearer). As rotas `/api/:projectId/...` são públicas, autenticadas pela key do DSN.

## Dashboard (`/v1`)

### Auth

| Método | Rota              | Descrição      |
| ------ | ----------------- | -------------- |
| POST   | `/v1/auth/login`  | login → token  |
| POST   | `/v1/auth/logout` | encerra sessão |
| GET    | `/v1/auth/me`     | usuário atual  |

### Projetos

| Método           | Rota                            | Descrição                     |
| ---------------- | ------------------------------- | ----------------------------- |
| GET/POST         | `/v1/projects`                  | listar / criar                |
| GET/PATCH/DELETE | `/v1/projects/:id`              | detalhe / atualizar / deletar |
| POST             | `/v1/projects/:id/rotate-key`   | trocar a key do DSN           |
| GET              | `/v1/projects/:id/environments` | ambientes vistos              |
| GET              | `/v1/projects/:id/releases`     | releases com estatísticas     |

### Issues

| Método | Rota                                                | Descrição                                         |
| ------ | --------------------------------------------------- | ------------------------------------------------- |
| GET    | `/v1/projects/:id/issues`                           | listagem (status, q, level, env, release, cursor) |
| GET    | `/v1/issues/:id`                                    | detalhe                                           |
| POST   | `/v1/issues/:id/resolve` · `/unresolve` · `/ignore` | ciclo de vida                                     |
| POST   | `/v1/issues/:id/merge`                              | merge com outras issues                           |
| POST   | `/v1/issues/batch`                                  | ações em lote                                     |
| GET    | `/v1/events/:id`                                    | evento completo (simbolizado se houver sourcemap) |

### Replays & sourcemaps

| Método     | Rota                                   | Descrição                              |
| ---------- | -------------------------------------- | -------------------------------------- |
| GET        | `/v1/projects/:id/replays`             | lista replays                          |
| GET/DELETE | `/v1/replays/:id`                      | detalhe (segmentos p/ player) / delete |
| GET/POST   | `/v1/projects/:id/sourcemaps`          | lista / upload (base64)                |
| DELETE     | `/v1/projects/:id/sourcemaps?release=` | limpa release                          |
| GET        | `/v1/projects/:id/sourcemap-releases`  | releases com contagens                 |

### Usuários & tokens

| Método          | Rota                | Descrição                              |
| --------------- | ------------------- | -------------------------------------- |
| GET/POST        | `/v1/users`         | listar / criar (owner)                 |
| POST            | `/v1/users/:id/2fa` | ativar TOTP                            |
| GET/POST/DELETE | `/v1/api-tokens`    | tokens para automação (CI, sentry-cli) |

## Ingestão (`/api`)

| Método | Rota                             | Descrição                           |
| ------ | -------------------------------- | ----------------------------------- |
| POST   | `/api/:projectId/envelope/`      | envelope multi-item (SDKs modernos) |
| POST   | `/api/:projectId/store/`         | JSON legado (gzip/deflate raw)      |
| POST   | `/api/:projectId/user-feedback/` | feedback widget                     |
| POST   | `/api/tunnel`                    | proxy anti ad-blocker               |

## sentry-cli (`/api/0`)

| Método          | Rota                                                     | Descrição              |
| --------------- | -------------------------------------------------------- | ---------------------- |
| GET             | `/api/0/organizations/:org/releases/:version/files/`     | lista artefatos        |
| GET/POST/DELETE | `/api/0/projects/:org/:project/releases/:version/files/` | upload/download/delete |

Autenticação: `X-Auth-Token` ou Bearer (API token). `chunk-upload` → `404` de propósito.
