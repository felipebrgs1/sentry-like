---
title: Alertas
description: Regras de alerta, canais (Slack/Discord/webhook) e digest diário.
---

Alertas sem infra de email — tudo via webhooks (Slack/Discord/genérico).

## Regras

| Tipo         | Dispara quando                                   |
| ------------ | ------------------------------------------------ |
| `new_issue`  | uma issue nova é criada                          |
| `regression` | uma issue resolvida reabre                       |
| `spike`      | pico de frequência                               |
| `age`        | issue ficou sem resolver X dias                  |
| `rate`       | ingestão perto do limite (≥80% em 1min, 1x/hora) |
| `digest`     | resumo diário das últimas 24h (cooldown 22h)     |

## Canais

- **Webhook genérico** — POST JSON para qualquer URL
- **Slack** — payload formatado para incoming webhook
- **Discord** — payload formatado para webhook

### Destinos permitidos (anti-SSRF)

A URL do webhook precisa ser `http(s)://` pública: destinos em loopback, rede privada, link-local (ex.: `169.254.169.254`, metadados de cloud) ou com credenciais na URL são recusados na criação **e** no envio (o host é resolvido de novo a cada disparo). Redirects não são seguidos e o corpo da resposta não é exibido — o histórico mostra só o status HTTP.

Se o seu destino é interno (n8n, Mattermost na LAN), libere com `ALLOW_PRIVATE_WEBHOOKS=1`.

## Infra

- Disparos de `new_issue`/`regression` acontecem **na ingestão** (síncrono, sem fila)
- Pico/idade/rate/digest no **check periódico** — `setInterval` 5min na VPS, cron `*/5` no Cloudflare
- Histórico em `alert_logs` + página de Alertas com CRUD, teste e ligar/desligar

## Configuração

No dashboard do projeto → aba **Alertas** → criar regra → escolher tipo, canal e destino.
