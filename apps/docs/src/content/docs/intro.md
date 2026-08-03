---
title: Sobre o projeto
description: O que é o sentrylike, filosofia e por que ele existe.
---

O **sentrylike** é um error tracking **compatível com o protocolo do Sentry**: os SDKs oficiais do Sentry funcionam apontando o DSN para cá, sem nenhuma alteração no código da aplicação.

## Filosofia

> **1:1 em features, não em arquitetura.**

O Sentry usa Kafka + ClickHouse para escalar para bilhões de eventos. Aqui o objetivo é entregar **as mesmas funcionalidades** rodando em uma **VPS micro** com **Bun + SQLite** — sem fila, sem broker, sem cluster.

Quando um item do roadmap exigir infraestrutura pesada, a resposta é _"fazer o mesmo comportamento com menos"_.

## O que já tem

| Área                                                                 | Status |
| -------------------------------------------------------------------- | ------ |
| Ingestão de envelopes + store legado + tunnel                        | ✅     |
| Issues & grouping (fingerprint custom, merge, regressão, prioridade) | ✅     |
| Performance (transactions, waterfall, p50/p95/p99, web vitals)       | ✅     |
| Alertas (regras, webhooks Slack/Discord, digest)                     | ✅     |
| Releases & environments                                              | ✅     |
| Sessões / crash-free                                                 | ✅     |
| Sourcemaps (sentry-cli + dashboard, simbolização)                    | ✅     |
| Replays (player básico, expiração 7d)                                | ✅     |
| Multi-usuário, 2FA, API tokens, organizações                         | ✅     |

## Stack

- **Runtime**: Bun 1.3+ em todo lugar (API, scripts, testes)
- **Backend**: Elysia (padrão MVC), Drizzle ORM sobre `bun:sqlite`
- **Frontend**: React 19 + TanStack Router + TanStack Query (Vite)
- **Monorepo**: Turborepo (tasks) + workspaces do Bun (link de pacotes)
- **Docs**: Astro Starlight (esta documentação)
