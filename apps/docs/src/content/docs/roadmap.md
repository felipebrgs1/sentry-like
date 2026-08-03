---
title: Roadmap
description: O plano de evolução — o que já está feito e o que vem a seguir.
---

> Texto completo em [`roadmap.md`](../../../../roadmap.md) na raiz do repositório.

## Legenda

✅ feito · 🔜 próximo · 📋 planejado · 🧪 experimental · ❌ fora de escopo (justificado)

## Estado atual

| Fase                                                                         | Status |
| ---------------------------------------------------------------------------- | ------ |
| **F1** — Protocolo de ingestão (envelope, tunnel, store, rate limit, CORS)   | ✅     |
| **F2** — Issues & grouping (fingerprint, merge, regressão, prioridade, lote) | ✅     |
| **F3** — Releases & environments                                             | ✅     |
| **F4** — Performance (transactions, waterfall, métricas, web vitals)         | ✅     |
| **F5** — Alertas (regras, webhooks, digest, rate alert)                      | ✅     |
| **F6** — Sessões, crash-free & user feedback                                 | ✅     |
| **F7** — Multi-usuário, 2FA, API tokens, organizações                        | ✅     |
| **F8** — Sourcemaps & simbolização                                           | ✅     |
| **F9** — Replays (player básico + expiração 7d)                              | 🧪     |
| **F10** — Polimento UI/UX (tema claro, atalhos, onboarding)                  | 🧪     |

## Próximos passos

1. **Cobertura de código** (F9) — 📋 depende de pipeline de CI (c8/istanbul); sem valor num self-host sem CI
2. **i18n** (F10) — 📋 textos hardcoded em pt-BR; revisão de ~15 páginas
3. **Infra & qualidade** — testes (unit + integração), backup do SQLite (VACUUM INTO), migrações com drizzle-kit, observabilidade em `/health`, rate limit global por IP

## Não-objetivos (decisões conscientes)

| Feature do Sentry               | Por quê não                                         |
| ------------------------------- | --------------------------------------------------- |
| Kafka / ClickHouse / workers    | Proposta central: micro VPS, 1 processo, zero infra |
| Replay por longos períodos      | Volume inviável em SQLite — expiração de 7d         |
| ML/grouping inteligente         | Fingerprint + regras cobrem o caso real             |
| Email (digest, convites, reset) | Sem infra SMTP; webhooks cobrem alertas             |
| SSO (Google/GitHub OAuth)       | Senha + 2FA já cobrem self-host de poucos usuários  |
| Postgres                        | SQLite + D1 cobrem o público (VPS e Workers)        |
