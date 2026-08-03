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
| Busca/filtros de issues (título, nível, ambiente, release)             | ✅     |
| Detalhe: stacktrace, breadcrumbs, tags, contexts, JSON raw, frequência | ✅     |
| Fase 2 completa: fingerprint custom, ignore com janela, regressão, merge, lote, prioridade, search salva, cursor, unread, owner | ✅ |
| Projetos: CRUD, DSN, rotate key, settings                              | ✅     |
| Auth single-user com sessão                                            | ✅     |
| Deploy: 1 container, SQLite, retenção                                  | ✅     |
| Performance: transactions/spans, waterfall, p50/p95/p99, web vitals, release-perf | ✅ |

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

## Fase 3 — Releases & environments completos 📋

- [ ] **Página de release** — deploy, commits (via GitHub/GitLab webhook), issues novas na release
- [ ] **Ciclo de release** — marcar deploys, comparar issues entre releases
- [ ] **Ambiente múltiplo por issue** — mostrar distribuição (hoje: coluna com o último)
- [ ] **Distribuição de eventos por ambiente/release** — no gráfico de frequência

## Fase 4 — Performance (transactions) ✅

O Sentry hoje é "error + performance". Para 1:1 precisamos das duas.

- [x] **Ingestão de transactions/spans** — tabelas `transactions` + `spans` (payload JSON, sem ClickHouse); itens de envelope `transaction` e `/store/` legado
- [x] **Waterfall de spans** — visualização temporal do trace (CSS puro); transaction raiz sintetizada como span 0
- [x] **Métricas** — p50/p95/p99, média, taxa de erro, throughput por endpoint (`transaction-summaries`), série diária
- [x] **Web vitals** — LCP, FCP, CLS, TTFB, INP, FP (measurements do browser SDK) com p50/p75/p95
- [x] **Transações por release** — `release-performance` comparando deploys + filtro de release em tudo
- [x] **Segmentação** — por rota (grouping por name), browser (`contexts.browser`), país (`user.geo.country_code`)

## Fase 5 — Alertas & notificações 📋

- [ ] **Regras de alerta** — new issue, regression, spike de frequência, "issue ficou sem resolver X dias"
- [ ] **Canais** — webhook genérico + Slack/Discord (formatos conhecidos), email
- [ ] **Digest diário** — resumo de atividades do dia por email
- [ ] **Rate alert** — alertar quando ingestão chegar perto do limite

## Fase 6 — Sessões, crash-free & feedback de usuário 📋

- [ ] **Sessões** — aceitar items `sessions`, crash-free rate por release
- [ ] **User feedback widget** — endpoint `user-report` + widget que o SDK exibe ao usuário após o erro
- [ ] **Gráfico de crash-free por release** — página de release fica completa

## Fase 7 — Multi-usuário & organizações 📋

- [ ] **Tabela de usuários** — senha com hash (argon2/bcrypt), não mais env var única
- [ ] **Organizações/teams** — projetos pertencem a orgs
- [ ] **Roles** — owner/member, convites por email
- [ ] **API tokens** — para automação (CI, upload de sourcemap)
- [ ] **2FA** — TOTP
- [ ] **SSO** — Google/GitHub OAuth (bom pra auto-host)

## Fase 8 — Sourcemaps & simbolização 🧪 (o item mais difícil)

- [ ] **Upload de sourcemaps** — endpoint `/api/:id/sourcemaps/` (SDK `sentry-cli` compatível)
- [ ] **Resolução** — mapa de versões de arquivo por release, aplicar no stacktrace ao exibir
- [ ] **Frames "similares"** — agrupamento por frames agrupados do bundler (webpack/rollup `webpack://`)
- [ ] **Contexto do código** — mostrar o código-fonte real (hoje: linha enviada pelo SDK)

## Fase 9 — Replays & cobertura 🧪

- [ ] **Session replay** — aceitar items `replay`, armazenar em disco, player básico (carregar em imagem o frame stream)
- [ ] **Cobertura de código** — stats de cobertura por release (o Sentry faz com monitores)
- [ ] **Diferencial**: Replay em SQLite é inviável para volumes grandes — decisão consciente de manter local + expirar em 7d

## Fase 10 — Polimento UI/UX 📋

- [ ] **Tema claro** (hoje dark-only)
- [ ] **Onboarding** — snippet de código do SDK por linguagem após criar projeto
- [ ] **Atalhos de teclado** — `g i` (issues), `/` (busca) etc.
- [ ] **Responsivo/mobile** — hoje otimizado para desktop
- [ ] **i18n** — pelo menos EN + PT-BR
- [ ] **PWA** — notificações locais de alerta
- [ ] **Empty states** — guias de integração quando projeto não tem eventos

## Infra & qualidade (transversal) 📋

- [ ] **Migrações com drizzle-kit** — substituir `CREATE IF NOT EXISTS`/ALTER manual
- [ ] **Backup** — script de snapshot do SQLite (VACUUM INTO) + retenção
- [ ] **Testes** — unit (ingestão, fingerprint, rate limit) + integração (SDK → API → DB)
- [ ] **Observabilidade do próprio servidor** — métricas de ingestão/latência em `/health`
- [ ] **Rate limit global por IP** — além do por projeto
- [ ] **Postgres como opção** — driver alternativo do Drizzle, sem mudar o resto (SQLite continua default)

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

---

## Como priorizar na prática (heurística)

1. **Fase 1 antes de tudo** — ingestão correta é o que mantém os SDKs funcionando.
2. **Fase 2 antes da 4** — ninguém liga pra performance se as issues estão bagunçadas.
3. **Sourcemaps (F8) só depois de performance (F4)** — ambos competem por tempo, sourcemaps valem mais quando o produto é usado em produção com bundlers.
4. **Cada fase deve terminar deployável** — nada de quebrar o `docker compose up` no meio do caminho.
