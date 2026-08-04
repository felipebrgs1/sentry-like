# Roadmap — sentrylike → 1:1 com Sentry

> **Filosofia**: 1:1 em **features**, não em **arquitetura**. O Sentry usa Kafka + ClickHouse para escalar para bilhões de eventos; aqui o objetivo é entregar as mesmas funcionalidades rodando em uma VPS micro com Bun + SQLite, sem fila, sem broker. Quando um item exigir infra pesada, a resposta é "fazer o mesmo comportamento com menos".

**Legenda**: ✅ feito · 🔜 próximo · 📋 planejado · 🧪 experimental · ❌ fora de escopo (justificado)

---

## Estado atual (snapshot)

| Área                                                                   | Status |
| ---------------------------------------------------------------------- | ------ |
| Ingestão de envelopes (`/api/:id/envelope/`) + store legado            | ✅     |
| Grouping por fingerprint (tipo + frames in-app)                        | ✅     |
| Issues: resolved/ignored, environment, release, counts                 | ✅     |
| Rate limiting com `X-Sentry-Rate-Limits`                               | ✅     |
| Dashboard (stats, gráfico 14d, recentes, resumo de performance, top rotas) | ✅     |
| Performance: página global + por projeto, waterfall, p50/p95/p99, web vitals | ✅     |
| Alertas: regras (nova/regressão/spike/idade/rate/digest), webhook Slack/Discord, histórico | ✅ |
| Releases: página por projeto, issues novas, comparação, webhook de deploy, distribuição | ✅ |
| Sessões/crash-free por release (série + card) e user feedback no detalhe da issue | ✅ |
| Busca/filtros de issues (título, nível, ambiente, release)             | ✅     |
| Detalhe: stacktrace, breadcrumbs, tags, contexts, JSON raw, frequência | ✅     |
| Fase 2 completa: fingerprint custom, ignore com janela, regressão, merge, lote, prioridade, search salva, cursor, unread, owner | ✅ |
| Projetos: CRUD, DSN, rotate key, settings                              | ✅     |
| Auth single-user com sessão                                            | ✅     |
| Deploy: 1 container, SQLite, retenção                                  | ✅     |
| Performance: transactions/spans, waterfall, p50/p95/p99, web vitals, release-perf | ✅ |
| Sourcemaps: upload (sentry-cli + dashboard), simbolização, frames similares, contexto | ✅ |
| Replays: sessões por projeto, player básico (DOM + interações), expiração 7d            | ✅ |
| Polimento F10: tema claro (toggle), onboarding com snippet, atalhos de teclado, empty states | ✅ |

---

## Fase 1 — Protocolo de ingestão (base sólida) ✅

Deixar a ingestão 100% compatível com o protocolo do Sentry.

- [x] **Envelope completo** — processar items de `attachment`, `sessions`, `replay`, `user-report`; anexos/recordings vão para disco (`DATA_DIR`), metadados no SQLite
- [x] **Tunnel endpoint** (`/api/tunnel`) — SDKs de browser enviam pelo proxy do Sentry para driblar ad-blockers (validado com `@sentry/browser` de verdade)
- [x] **`store/` legado completo** — gzip e deflate (raw)
- [x] **Categoria de rate limit por item** — buckets separados por categoria, header `X-Sentry-Rate-Limits` com retry por categoria
- [x] **CORS/Origin check** — `allowed_domains` por projeto (suporta `*.exemplo.com`), configurável no dashboard
- [x] **Validação de payload com schema** — evento malformado rejeitado com mensagem descritiva (`400 {detail: "event has no message..."}`)
- [x] **Client Reports / SDK feedback** — item `client_report` do envelope persistido em tabela para métricas futuras
- [x] **`sentry-trace`/`baggage`** — parsing do header e injeção no `contexts.trace` do evento (pré-requisito da fase 4; validado: SDK browser envia trace real)

## Fase 2 — Issues & grouping (o coração do produto) ✅

- [x] **Fingerprint custom** — respeitar `event.fingerprint` enviado pelo SDK (hoje: hash interno)
- [x] **Ignorar com janela de tempo** — "ignorar por 30m / 1h / 24h" com expiração (status `ignored_until`); janela expirada conta como aberta e evento novo reabre
- [x] **Badge de regressão** — marcar issue que reabriu depois de resolvida
- [x] **Merge / unmerge de issues** — juntar issues iguais manualmente (`original_issue_id` por evento permite desfazer)
- [x] **Ações em lote** — selecionar múltiplas issues na listagem e resolver/ignorar/marcar vistas/deletar/mesclar
- [x] **Prioridade** — scoring (nível × frequência × recência) com labels low/medium/high
- [x] **Search salva** — salvar combinações de filtro como views por projeto
- [x] **Paginação com cursor** — listagens com cursor base64 (lastSeen,id), "carregar mais" no front
- [x] **"Mark as seen" / unread** — indicador de não-lido por issue; ver o detalhe marca como lida
- [x] **Assigned user / owner** — campo de atribuição (texto livre; útil quando multi-user chegar)

## Fase 3 — Releases & environments completos ✅

- [x] **Página de release** — lista auto-descoberta (events + transactions), detalhe com issues novas na release (primeiro evento com aquela release), ambientes, latência (avg/p95/erro) e commits
- [x] **Ciclo de release** — comparar issues entre releases (side-by-side: eventos, issues novas, latência, erro); marcar deploy via webhook GitHub/GitLab push (refs/tags) com commits
- [x] **Ambiente múltiplo por issue** — distribuição por ambiente/release no detalhe da issue (hoje: coluna com o último)
- [x] **Distribuição de eventos por ambiente/release** — barras no detalhe da release e no detalhe da issue

## Fase 4 — Performance (transactions) ✅

O Sentry hoje é "error + performance". Para 1:1 precisamos das duas.

- [x] **Ingestão de transactions/spans** — tabelas `transactions` + `spans` (payload JSON, sem ClickHouse); itens de envelope `transaction` e `/store/` legado
- [x] **Waterfall de spans** — visualização temporal do trace (CSS puro); transaction raiz sintetizada como span 0
- [x] **Métricas** — p50/p95/p99, média, taxa de erro, throughput por endpoint (`transaction-summaries`), série diária
- [x] **Web vitals** — LCP, FCP, CLS, TTFB, INP, FP (measurements do browser SDK) com p50/p75/p95
- [x] **Transações por release** — `release-performance` comparando deploys + filtro de release em tudo
- [x] **Segmentação** — por rota (grouping por name), browser (`contexts.browser`), país (`user.geo.country_code`)

## Fase 5 — Alertas & notificações ✅

- [x] **Regras de alerta** — new issue, regression, spike de frequência, "issue ficou sem resolver X dias", perto do rate limit, digest diário
- [x] **Canais** — webhook genérico + Slack + Discord (payloads formatados)
- [x] **Digest diário** — resumo das últimas 24h (novas issues, eventos, top issues) via webhook, cooldown 22h
- [x] **Rate alert** — alertar quando ingestão chegar perto do limite (≥80% em 1min, 1x/hora)
- [x] **Infra** — disparos de new_issue/regression na ingestão; pico/idade/rate/digest no check periódico (setInterval 5min na VPS, cron */5 no CF); histórico em `alert_logs` + página de Alertas com CRUD/testar/ligar-desligar

## Fase 6 — Sessões, crash-free & feedback de usuário ✅

- [x] **Sessões** — aceitar items `sessions` (já na F1) + crash-free rate por release (status crashed/abnormal) com série temporal diária
- [x] **User feedback widget** — endpoint legado `/api/:id/user-feedback/` (key do DSN) + item `user_report` do envelope (já na F1); feedback exibido no detalhe da issue (join por event_id normalizado)
- [x] **Gráfico de crash-free por release** — página de release completa: card crash-free (sessões) + série de 14 dias colorida por saúde (≥99% verde, ≥95% âmbar, senão vermelho); releases agora também são auto-descobertas a partir de sessões

## Fase 7 — Multi-usuário & organizações ✅

- [x] **Tabela de usuários** — senha com hash PBKDF2-SHA256 (Web Crypto, portável Bun/Worker), não mais env var única; bootstrap cria o owner do env
- [x] **Organizações/teams** — tabelas `orgs` + `org_members`; projetos têm `org_id` (backfill na org default); membros veem só projetos da org
- [x] **Roles** — owner (tudo) / member (leitura + triagem); mutações de projeto e gestão de usuários são owner-only; criação de usuário é feita pelo owner (sem convite por email)
- [x] **API tokens** — Bearer para automação (CI, upload de sourcemap), com revogação e lastUsedAt
- [x] **2FA** — TOTP (RFC 6238, HMAC-SHA1 via Web Crypto) com URI otpauth, confirmação e exigência no login

## Fase 8 — Sourcemaps & simbolização ✅

O item mais difícil do roadmap — resolvido com um parser de sourcemap v3 (VLQ) sem dependências, rodando em Bun/Workers.

- [x] **Upload de sourcemaps** — dois caminhos: protocolo do `sentry-cli` (`/api/0/organizations/:org/releases/:version/files/`, `/api/0/projects/:org/:project/releases/:version/files/`, DELETE por URL) com auth por API token (`X-Auth-Token`/Bearer) e org slug; e dashboard (`/v1/projects/:id/sourcemaps`) com upload por base64; `chunk-upload` responde 404 de propósito → sentry-cli cai no upload individual (VPS micro, sem bucket de chunks)
- [x] **Resolução** — artefatos por (project, release, nome) em `sourcemap_files` (conteúdo no BlobStore); lookup no stacktrace tenta: artefato-fonte → comentário `sourceMappingURL` → map relativo; `nome.map` direto; normaliza `~/`, URLs completas e query/hash; cache LRU em memória (mapas decodificados, até 32 entradas)
- [x] **Frames "similares"** — na ingestão, se a release tem sourcemaps, o fingerprint usa os frames simbolizados: chunks minificados diferentes com a mesma origem agrupam na mesma issue (validado: `app.js` e `app.js?v=2` → 1 issue)
- [x] **Contexto do código** — `sourcesContent` do map exibido no detalhe da issue (badge "original" + linha/coluna/função originais + código-fonte real; a linha minificada fica como secundária)

## Fase 9 — Replays & cobertura 🧪

- [x] **Session replay** — aceitar items `replay_event`/`replay_recording` (já na F1), segmentos no BlobStore (um por recording, com idempotência por `segment_id` e upsert que aceita recording antes do event), player básico: reconstrução do DOM a partir dos eventos rrweb (FullSnapshot + mutations de texto/atributo/nó), sanitização anti-XSS, timeline de interações (clique/input/scroll), slider temporal com play/pause, viewport escalado; páginas de listagem (`/projects/:id/replays`) e detalhe (`/replays/:id`)
- [ ] **Cobertura de código** — stats de cobertura por release (o Sentry faz com monitores). 📋 planejado: exige pipeline de CI + agente de cobertura (c8/istanbul) e tem pouco valor num self-host sem CI configurada
- [x] **Diferencial**: Replay em SQLite é inviável para volumes grandes — decisão consciente: segmentos em disco (BlobStore) + expiração em 7d (`REPLAY_RETENTION_DAYS`, retenção integrada ao `runRetention`)

## Fase 10 — Polimento UI/UX 🧪

- [x] **Tema claro** — o CSS já definia `:root` light + `.dark`; removida a classe fixa do `index.html` e criado toggle (Sun/Moon) no header com persistência em localStorage (`lib/theme.ts`); default continua dark
- [x] **Onboarding** — componente `SdkSnippet` com abas por linguagem (JS/React/Vue/Python/PHP/Ruby) + `ProjectEmptyState` (guia de 3 passos, botão copiar, comando de teste com o DSN) mostrado quando o projeto ainda não tem eventos
- [x] **Atalhos de teclado** — sequência `g o/p/i/r/s` (navegação), `/` (foca a busca de issues via evento), `?` (painel de ajuda em Sheet); ignorados em inputs
- [~] **Responsivo/mobile** — ajustes básicos (paddings do main, tabelas já com overflow-x-auto nativo, tabs com wrap, header colapsa o título); validação visual em telas pequenas fica pendente 🧪
- [ ] **i18n** — 📋 planejado: todos os textos estão hardcoded em pt-BR; mecanismo de dicionário exigiria revisar ~15 páginas — sem valor imediato num self-host pt-BR
- [x] **Empty states** — guia de integração quando o projeto não tem eventos (substitui o "nenhuma issue" genérico quando o projeto está vazio de verdade)

## Infra & qualidade (transversal) 📋

- [ ] **Migrações com drizzle-kit** — substituir `CREATE IF NOT EXISTS`/ALTER manual
- [ ] **Backup** — script de snapshot do SQLite (VACUUM INTO) + retenção
- [x] **Testes** — unit (envelope, fingerprint, validação, rate limit com janela, prioridade, timeseries, senha PBKDF2, TOTP com referência RFC 6238, sourcemap VLQ, blob storage) + integração/E2E (ingestão via HTTP in-process, auth/2FA/tokens, issues & regressão/merge, performance/waterfall, alertas com webhook local, sessões/crash-free, replay, sourcemaps sentry-cli); `bun test --parallel` isola cada arquivo em DB temporário próprio (preload) — 135 testes
- [ ] **Observabilidade do próprio servidor** — métricas de ingestão/latência em `/health`
- [ ] **Rate limit global por IP** — além do por projeto
- [x] **Cloudflare Workers como opção de deploy** — D1 (driver drizzle assíncrono), R2 (blobs), KV (rate limit), Static Assets (SPA), cron de retenção; VPS continua default via `bun run start`

---

## Não-objetivos (decisões conscientes)

| Feature do Sentry                                                  | Por quê não                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Kafka / ClickHouse / workers                                       | Proposta central: micro VPS, 1 processo, zero infra                             |
| Horizontal scaling / multi-region                                  | Não é o público-alvo; se precisar, migra-se a camada de storage                 |
| Replay por longos períodos                                         | Volume inviável em SQLite — expiração de 7d, igual em natureza mas menor escopo |
| ML/grouping inteligente (Sentry usa aprendizado p/ sugerir grupos) | Fora de proporção; fingerprint + regras cobrem o caso real                      |
| Quotas/planos de faturamento                                       | Sem SaaS, sem billing                                                           |
| Integrações de terceiros completas (Jira, Linear, Slack app)       | Vem via webhooks genéricos                                                      |
| Email (digest, convites, reset de senha)                           | Sem infra SMTP; webhooks cobrem alertas, owner cria usuários direto e reset é por prova de posse (secret/shell) |
| SSO (Google/GitHub OAuth)                                          | Auto-host de poucos usuários — senha + 2FA já cobrem; exigiria client id/secret e callbacks |
| PWA / notificações locais                                           | Sem loja de apps; alertas já chegam via webhook (Slack/Discord)                      |
| Postgres como opção                                                 | SQLite + D1 cobrem o público (VPS micro e Workers); trocar de banco exigiria refactor da camada de dados |

---

## Como priorizar na prática (heurística)

1. **Fase 1 antes de tudo** — ingestão correta é o que mantém os SDKs funcionando.
2. **Fase 2 antes da 4** — ninguém liga pra performance se as issues estão bagunçadas.
3. **Sourcemaps (F8) antes do replay (F9)** — sourcemaps valem mais quando o produto é usado em produção com bundlers; replay é o item mais pesado do roadmap.
4. **Cada fase deve terminar deployável** — nada de quebrar o `docker compose up` no meio do caminho.
5. **F9 (replay) concluído** — player básico + expiração 7d; cobertura de código ficou 📋 (depende de pipeline de CI, sem valor num self-host sem CI)
6. **F10 (polimento UI/UX) em andamento** — tema claro, onboarding, atalhos e empty states concluídos; responsivo 🧪 e i18n 📋 (textos hardcoded, sem valor imediato num self-host pt-BR)
7. **Infra & qualidade é o próximo grande bloco** — testes (unit + integração), backup do SQLite e migrações com drizzle-kit; também "observabilidade do servidor" e rate limit global por IP
