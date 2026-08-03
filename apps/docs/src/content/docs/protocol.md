---
title: Protocolo de ingestão
description: Como o sentrylike fala o protocolo do Sentry — endpoints, autenticação e envelope.
---

O sentrylike implementa o protocolo de ingestão do Sentry para receber eventos dos SDKs sem adaptação.

## Endpoints

| Endpoint                              | Uso                                          |
| ------------------------------------- | -------------------------------------------- |
| `POST /api/:projectId/envelope/`      | SDKs modernos (formato envelope, multi-item) |
| `POST /api/:projectId/store/`         | SDKs legados (JSON único; gzip/deflate raw)  |
| `POST /api/:projectId/user-feedback/` | widget de feedback de usuário                |
| `POST /api/tunnel`                    | browsers via proxy (anti ad-blocker)         |

## Autenticação

A key do DSN pode vir de três lugares (como no Sentry):

- header `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<key>, ...`
- header `Authorization`
- query `?sentry_key=<key>`

Sem key válida → `403`.

## Envelope (formato exato)

O envelope é: 1 linha de header + pares `(header item, payload)`, com `length` em bytes:

```text
{ "event_id": "abc123...", "dsn": "http://key@host/1" }
{ "type": "event", "content_type": "application/json", "length": 123 }
{ ...event JSON... }
{ "type": "transaction", "content_type": "application/json", "length": 456 }
{ ...transaction JSON... }
```

Itens suportados:

| Item               | Tratamento                                                     |
| ------------------ | -------------------------------------------------------------- |
| `event`            | validação + persistência + grouping                            |
| `transaction`      | tabelas `transactions` + `spans` (performance)                 |
| `attachment`       | blob em disco (`DATA_DIR`), metadados no SQLite                |
| `sessions`         | contagem de sessões / crash-free                               |
| `replay_event`     | metadados da sessão de replay (upsert)                         |
| `replay_recording` | segmento em `replay_recordings` (idempotente por `segment_id`) |
| `user_report`      | feedback ligado ao evento                                      |
| `client_report`    | estatísticas de envio do SDK                                   |

## Validação

Todo evento passa por `validateEvent()` antes de persistir — payload malformado é rejeitado com `400` e motivo descritivo:

```json
{ "detail": "event has no message..." }
```

## Compressão

- **gzip** → `Bun.gunzipSync`
- **deflate** → `Bun.inflateSync` (**raw deflate**, RFC 1951 — não zlib)

## Rate limit

Limite por **categoria** (`error`, `transaction`, etc.). Ao estourar, a resposta traz o header:

```text
X-Sentry-Rate-Limits: 60000:error:project;...
```

## Origin check

Se o projeto define `allowed_domains` (JSON array, aceita `*.dominio.com`), requisições com `Origin` fora da lista são rejeitadas com `403`. Sem `Origin` (server-to-server) ou lista vazia = liberado.
