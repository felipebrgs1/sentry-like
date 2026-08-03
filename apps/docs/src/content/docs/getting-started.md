---
title: Começar rápido
description: Suba o sentrylike em minutos e receba seu primeiro evento.
---

## Rodando localmente

```bash
bun install
bun run dev        # turbo dev: API :3001 + Vite :5173 (proxy /api e /v1 → :3001)
```

O seed cria um projeto **"Demo Project"** com um DSN pronto quando o banco está vazio. A public key aparece nos logs do primeiro boot:

```text
[sentrylike] seeded "Demo Project" (id=1), public key: 3db8a92b5d5c4adba15e258289742554
```

## Enviando um evento de teste (sem SDK)

```bash
bun scripts/send-test-event.ts "http://<key>@localhost:3001/1"
```

Ou via envelope cru (formato exato do protocolo — 1 linha de header por item):

```text
{ "event_id": "abc...", "dsn": "http://key@host/1" }
{ "type": "event", "content_type": "application/json", "length": 123 }
{ ...event JSON... }
```

## Produção (Docker)

```bash
docker compose up -d --build
```

Um único container na porta `3000`:

- API Bun servindo `/api`, `/v1` e `/health`
- SPA do dashboard em `/`
- Documentação em `/docs`
- SQLite em volume `/data`

### Variáveis de ambiente

| Variável                        | Padrão                  | Uso                                      |
| ------------------------------- | ----------------------- | ---------------------------------------- |
| `PORT`                          | `3000`                  | porta HTTP                               |
| `DATABASE_PATH`                 | `sentrylike.db`         | arquivo SQLite                           |
| `DATA_DIR`                      | `<db>/blobs`            | blobs (attachments, replays, sourcemaps) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | gerada                  | usuário owner do primeiro login          |
| `RETENTION_DAYS`                | `30`                    | retenção de eventos/transactions         |
| `REPLAY_RETENTION_DAYS`         | `7`                     | retenção de replays                      |
| `APP_URL`                       | `http://localhost:3001` | URL pública (links de alertas)           |

> Se `ADMIN_PASSWORD` não for definida, uma senha aleatória é gerada e impressa no log de boot.
