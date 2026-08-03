---
title: Performance
description: Transactions, spans, waterfall e métricas — p50/p95/p99 e web vitals.
---

O Sentry hoje é "error + performance". O sentrylike entrega os dois.

## Ingestion

- Itens de envelope `transaction` e o `/store/` legado
- Tabelas `transactions` + `spans` (payload JSON — sem ClickHouse)
- A transaction raiz é sintetizada como **span 0** no waterfall

## Métricas

| Métrica         | Descrição                                                                  |
| --------------- | -------------------------------------------------------------------------- |
| p50 / p95 / p99 | latência por transaction                                                   |
| Taxa de erro    | % de transactions com status de erro                                       |
| Throughput      | `transaction-summaries` por endpoint                                       |
| Web vitals      | LCP, FCP, CLS, TTFB, INP, FP (measurements do browser SDK) com p50/p75/p95 |

## Segmentação

- **Por rota** — grouping por `transaction.name`
- **Por browser** — `contexts.browser`
- **Por país** — `user.geo.country_code`

## Visualização

- Página global e por projeto
- **Waterfall de spans** — visualização temporal do trace (CSS puro)
- Série temporal diária
- Transações por release (comparando deploys)

## Integração

O header `sentry-trace`/`baggage` enviado pelos SDKs é parseado e injetado em `contexts.trace` — conectando errors e transactions na mesma sessão.
