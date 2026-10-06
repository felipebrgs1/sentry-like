# Roadmap — sentrylike → conformidade 1:1 com o Sentry

> **Filosofia**: 1:1 em **features**, não em **arquitetura**. Mesmo protocolo, mesma API, mesma UX — rodando em Bun + SQLite numa VPS micro, sem fila, sem broker. Quando um item exigir infra pesada, a resposta é "fazer o mesmo comportamento com menos".

**Legenda**: ✅ feito · 🔜 próximo · 📋 planejado · 🧪 experimental · ❌ fora de escopo (justificado)
**Prioridade**: **P0** quebra SDK/segurança · **P1** qualidade central do produto · **P2** paridade de features · **P3** nice-to-have

As Fases 1–10 (ingestão, issues, releases, performance, alertas, sessões, multi-usuário, sourcemaps, replays, polimento) foram entregues — histórico em `git show fa2e8f7^:roadmap.md`. Este roadmap nasce do **pente fino de conformidade de 2026-10-05**, que comparou ingestão, API e UI com o Sentry/Relay real e encontrou itens marcados como ✅ que não funcionam com SDKs oficiais.

---

## Estado atual (snapshot pós-auditoria)

| Área                                       | Status | Resumo                                                                                      |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| Segurança da ingestão e do dashboard       | 🔴     | path traversal via `event_id`, XSS no replay, bomba de descompressão, sem authz por projeto |
| Ingestão com SDKs reais                    | 🟠     | caso feliz JS/Python ok; rate limit, replay, `br`, `message` objeto quebram                 |
| Integridade de dados                       | 🟠     | retenção falha por FK, `await`s faltando, contagem dupla em retry                           |
| Grouping                                   | 🟡     | exceção encadeada, `{{ default }}`, mensagens não parametrizadas                            |
| Sourcemaps com `sentry-cli`/bundlers reais | 🟠     | formato de upload inventado; artifact bundles/debug IDs ausentes                            |
| UI (navegação, issues, detalhe)            | 🟡     | sem estado na URL, IA por projeto, stream e detalhe incompletos                             |
| API `/api/0/` compatível                   | 🔵     | só release files existem; o resto é `/v1` com shapes próprios                               |

---

## Fase 11 — Segurança (P0) ✅

Tudo aqui era explorável com a **key pública do DSN** ou com um usuário `member`. Testes em `test/integration/security.test.ts` e `test/unit/replay-sanitize.test.ts`.

- [x] **Identidade por request** — o `authGuard` gravava o usuário em `ctx.store` (estado **global** do Elysia): sob concorrência um request lia o usuário de outro (member virando owner). Agora `currentUser(request)` (WeakMap por `Request`, `middleware/auth.ts`).
- [x] **Path traversal no BlobStore** — `normalizeId()` (hex32/UUID, como o Relay) em `event_id`/`replay_id`/user reports; `saveBlob` só aceita segmentos `[A-Za-z0-9_-]` e read/delete não saem de `DATA_DIR`. Sourcemaps usam diretório aleatório por upload (o nome da release virava pasta, e re-upload com conteúdo novo apagava o blob recém-gravado).
- [x] **XSS no player de replay** — whitelist de nome de atributo + render em `<iframe sandbox="">` com CSP sem rede (`default-src 'none'`). Trade-off: imagens/fontes remotas do site gravado não carregam (evita vazar o IP de quem assiste).
- [x] **Bomba de descompressão** — `lib/body.ts`: corpo e descompressão em stream com teto (`MAX_ENVELOPE_BYTES`) em envelope/store/tunnel/user-feedback; 413 acima do limite, 400 para encoding inválido/desconhecido (antes 500).
- [x] **Authz por projeto** — `canAccess(kind)` (`middleware/access.ts`) como `beforeHandle` em toda rota `/v1` com recurso (404 se inacessível); `ownerOnly` nas mutações de projeto; `/v1/stats`, `/v1/issues`, `/v1/performance/summaries`, batch e merge filtrados pelos projetos visíveis; merge só dentro do mesmo projeto.
- [x] **SSRF no webhook de alerta** — `lib/netguard.ts`: só http(s) público, sem credenciais; recheca DNS no envio, não segue redirect, timeout 10s, corpo da resposta nunca é devolvido. `ALLOW_PRIVATE_WEBHOOKS=1` libera destinos internos.
- [x] **Webhook de deploy assinado** — segredo por projeto (`projects.webhook_secret`; owner gera/rotaciona no dashboard); aceita `X-Hub-Signature-256` (GitHub), `X-Gitlab-Token` e `X-Sentrylike-Token`. Projetos antigos começam sem segredo = webhook desativado.
- [x] **Tokens e login** — sessão e API token guardados como SHA-256 (migração automática no boot); listagem não expõe a coluna; 10 falhas/15 min por usuário → 429 no login, TOTP e troca de senha; sentry-cli autentica antes de revelar se a org existe.
- [ ] **Escopos de token** — movido para a Fase 23.

## Fase 12 — Ingestão: bugs que quebram SDKs oficiais (P0) 🔜

- [ ] **`X-Sentry-Rate-Limits` em segundos** — `lib/ratelimit.ts:96` emite `60000:` (≈17h de bloqueio no SDK). Emitir `60:` (janela restante), adicionar `Retry-After`, corrigir `test/integration/ingest.test.ts:369` e a regra no AGENTS.md §5.
- [ ] **CORS na resposta 429 e headers expostos** — `ingest.controller.ts:189` substitui `set.headers` (apaga o ACAO do plugin); fazer merge. Configurar `exposeHeaders: ["X-Sentry-Error","X-Sentry-Rate-Limits","Retry-After"]` em `index.ts`.
- [ ] **429 parcial** — envelope com algumas categorias limitadas responde 200 + header (como o Relay); 429 só quando tudo foi descartado. Adicionar `replay`, `feedback`, `monitor`, `span`, `log_item`, `profile` às categorias; `user_report` conta como `default`.
- [ ] **Formato real do `replay_recording`** — linha de header `{"segment_id":N}\n` + corpo gzip (compression worker) ou array JSON de eventos rrweb; `replay_id` vem do **`event_id` do envelope**. Reescrever `ingest.service.ts:376` e o reader `replay.service.ts:167`. Persistir `replay_event` só depois de validar o item.
- [ ] **`message` como objeto** — normalizar `message: {message, params, formatted}` → `logentry` (como o Relay) antes de `eventTitle` (`ingest.service.ts:36`); corrigir o tipo em `packages/shared`.
- [ ] **Content-Encoding** — suportar `gzip`, `deflate` (zlib RFC 1950, com fallback para raw), `br` (default do sentry-python com brotli instalado) e `zstd`; encoding desconhecido → 415/400. Atualizar a regra "deflate é RAW" do AGENTS.md §5/§8.
- [ ] **Item malformado não derruba o envelope** — erro por item vira descarte daquele item (outcome), não 400 do envelope inteiro com metade persistida.
- [ ] **Fixtures de SDK real** — capturar envelopes reais (`@sentry/browser` com replay, `@sentry/node`, `sentry-python` com `br`, `sentry-java`, `sentry-cli`) em `apps/api/test/fixtures/` e usar nos testes de integração. Os testes atuais de replay e sourcemap validam formatos inventados.

**Pronto quando**: `@sentry/browser` (erros + replay + tunnel), `@sentry/node` e `sentry-python` rodando contra a API local enviam tudo sem erro, e um rate limit forçado faz o SDK pausar ~60s.

## Fase 13 — Integridade de dados no backend (P0/P1) 🔜

- [ ] **Retenção quebrada** — `lib/retention.ts:15` apaga `transactions` antes de `spans` (FK) e aborta; replays nunca expiram. Apagar filhos primeiro; cobrir também `sessions`, `client_reports`, `attachments` (+ blobs), `user_reports`, `alert_logs`; recalcular contadores das issues. Teste de retenção.
- [ ] **Deletar regra de alerta que já disparou** — FK de `alert_logs` (`alert.service.ts:80`): apagar logs ou `ON DELETE SET NULL`.
- [ ] **`deleteIssue` sem `await`** — `issue.service.ts:194`; remover também `user_reports`, `attachments` e issues mescladas; opção "delete & discard" com tombstone do fingerprint.
- [ ] **Escritas fire-and-forget** — `batchUpdate`, `updateIssueStatus`, `recomputeIssueStats` no merge e `storeAttachment` sem `await` (corrida real no D1).
- [ ] **Retry do SDK conta em dobro** — `ingest.service.ts:84-103` incrementa `eventCount`/`lastSeen` antes do `onConflictDoNothing`; inverter a ordem.
- [ ] **Transaction com `:` truncada** — `split(":")` em `stats.service.ts:115` e `performance.service.ts:268` (`GET /users/:id`).
- [ ] **Ignored expirado** — `status=ignored` não deve listar issues cuja janela expirou (`issue.service.ts:83-87`); `recomputeIssueStats` usa o level real, não `"error"` fixo (`:330`).

## Fase 14 — Grouping e títulos fiéis ao Sentry (P1)

Afeta diretamente a qualidade das issues — vem antes de qualquer feature nova.

- [ ] **Exceção principal = última de `values[]`** — `lib/fingerprint.ts:18` e `ingest.service.ts:34,44` usam `[0]` (causa raiz). Agrupar pela cadeia toda, titular pela mais externa.
- [ ] **Variáveis de fingerprint** — expandir `{{ default }}`, `{{ transaction }}`, `{{ type }}`, `{{ function }}`, `{{ level }}` (`fingerprint.ts:14`).
- [ ] **Exceção sem frames** — agrupar por `type` + `value` normalizado, não por transaction/`"unknown"` (`fingerprint.ts:30`).
- [ ] **Parametrização de mensagens** — remover números, UUIDs, IPs, hex, datas; preferir `logentry.message` (template) a `formatted`.
- [ ] **Frames estáveis entre deploys** — usar `module` quando houver, limpar hash/query do `filename`, `context_line` quando a função for anônima; só frames `in_app` quando existirem.
- [ ] **Culprit** — frame in_app mais alto (ou a transaction), não o último frame (`ingest.service.ts:44-48`).
- [ ] **Normalizações do Relay** — aliases de level (`warn`→warning, `critical`→fatal, `log`→info); `exception: [...]` legado; `event.stacktrace`/`threads`; `user.ip_address: "{{auto}}"` → IP do cliente; `event_id` ausente herda do header do envelope; evento sem conteúdo aceito como `<unlabeled event>`.
- [ ] **Migração de grouping** — versão do algoritmo gravada na issue (`grouping_config`), para não fragmentar issues existentes ao trocar o algoritmo.

## Fase 15 — Cobertura do protocolo (P1/P2)

Itens que os SDKs mandam e hoje viram 200 "ignored".

- [ ] **`sessions` (agregados)** — server-mode do sentry-python (WSGI/ASGI) e request-mode do Node só mandam agregados; hoje o release health de backend fica vazio. P1.
- [ ] **Sessões corretas** — respeitar `seq`/`init` (update fora de ordem não regride), `abnormal` separado de `crashed`, `errored` como bucket, **crash-free users** por `did`. P1.
- [ ] **`feedback`** (User Feedback novo, JS v8+ `feedbackIntegration` / Python `capture_feedback`) + UI de feedback. P1.
- [ ] **`check_in`** → Crons/Monitors (Fase 22). P2.
- [ ] **`/api/:id/security/`** — CSP / Expect-CT / HPKP reports (`application/csp-report`) e item `raw_security`. P2.
- [ ] **Minidumps** — `attachment_type: event.minidump` e `/api/:id/minidump/` sintetizam evento (sentry-native/Electron); simbolização nativa ❌ (ver não-objetivos). P3.
- [ ] **`log` / `otel_log`** — Sentry Logs (`enableLogs`). P2.
- [ ] **`span` standalone** (INP etc.) e DSC (`trace` do header) ligados ao trace. P2.
- [ ] **`sent_at`** para correção de clock drift. P3.
- [ ] **Outcomes** — registrar accepted/filtered/rate_limited/invalid por categoria (base do Stats, Fase 22) + ler os `client_report` já armazenados. P2.
- [ ] **Auth como o Relay** — 401 sem auth / 403 key inválida com `{"detail": ...}` + `X-Sentry-Error`; aceitar DSN legado `key:secret@`; tunnel confere project id do DSN contra a key. P2.

## Fase 16 — Sourcemaps & `sentry-cli` reais (P1)

Hoje o upload real não funciona em praticamente nenhum setup moderno.

- [ ] **Upload legado multipart** — `releases/:v/files/` aceita `multipart/form-data` (`file`, `name`, `dist`, `header` repetido); listagem devolve **array** puro, não `{files}` (`sourcemap.controller.ts:241`). Manter o JSON/base64 só para o dashboard.
- [ ] **Releases para o CLI** — `releases new`, `finalize`, `set-commits`, `deploys new` (`/api/0/organizations/:org/releases/` + `/deploys/` + `/commits/`).
- [ ] **Chunk upload + artifact bundles** — `GET/POST /api/0/organizations/:org/chunk-upload/` e `.../artifactbundle/assemble/`; chunks por SHA-1 no BlobStore. Necessário para `sentry-cli` 3.x e para os plugins de bundler (vite/webpack/esbuild).
- [ ] **Debug IDs** — simbolizar via `debug_meta.images[type=sourcemap]` / `//# debugId=`, sem depender de release; casar `dist` quando presente (`sourcemap.service.ts:312-369`).
- [ ] **Teste com `sentry-cli` de verdade** (binário no CI) e corrigir `apps/docs/.../sourcemaps.md`.

## Fase 17 — UI: fundação (P1)

Base para tudo de UI que vem depois.

- [ ] **Estado na URL** — `validateSearch`/`useSearch` em todas as listas e detalhes: busca, aba, filtros, sort, cursor, evento selecionado, transaction, release. Reload e link compartilhado preservam o estado.
- [ ] **Page filters globais** — barra de projeto + ambiente + período (`?project=&environment=&statsPeriod=`) no `AppLayout`, persistida entre páginas como no Sentry.
- [ ] **Navegação do Sentry** — Issues, Explore (Traces, Replays, Releases, Discover/Logs futuros), Insights (Performance), Crons, Alerts, Settings — **globais**, filtradas pelos page filters. Landing = Issues. Overview vira opcional/Dashboards.
- [ ] **Abas de projeto únicas** — extrair `ProjectTabs` com `<Link>` (hoje copiado em 6 páginas, com abas faltando: Releases em Performance/Alerts, Sourcemaps/Replays em várias).
- [ ] **Rotas no padrão Sentry** — `/issues/:id/`, `/issues/:id/events/:eventId/`, `/replays/:id/`, `/releases/:version/`.
- [ ] **Básicos de usabilidade** — `document.title` por página; tooltip com data absoluta em todo `timeAgo`; `errorComponent` no router + estados de erro nas queries e toasts nas mutations (sem `API 400: {json}` cru); linhas navegáveis como `<Link>` (teclado, cmd-click); breadcrumb do header clicável com nomes, não ids.
- [ ] **Bugs** — hooks após early return em `ReplayDetailPage.tsx:109`; `markSeen` nas deps (`IssueDetail.tsx:429`); `<button>` aninhado (`Performance.tsx:331/353`, `ProjectIssues.tsx:529`); empty state de onboarding aparecendo com filtros ativos (`ProjectIssues.tsx:683`); `g i` indo para `/projects`; "← projetos" levando a issues; padding duplo no replay; linha sem `onClick` em `PerformanceGlobal.tsx:86`.

## Fase 18 — UI: Issues stream & detalhe (P1)

- [ ] **Stream** — linha no formato Sentry: **tipo** em negrito + mensagem + culprit, shortId, badge unhandled/new/regressed, sparkline 24h/14d, colunas Events / Users / Assignee / Priority; sort (Last Seen, First Seen, Events, Users, Priority); "selecionar todas as N que batem com a busca"; paginação com cursor.
- [ ] **Busca com sintaxe do Sentry** — `is:unresolved level:error release:x environment:y assigned:me !tag:value`, com autocomplete de chaves/valores de tag (backend em Fase 20).
- [ ] **Abas de status** — Unresolved / For Review / Regressed / Escalating / Archived (+ saved searches como abas, não dropdown).
- [ ] **Header do detalhe** — título, culprit, shortId copiável, prioridade, assignee, Resolve (com dropdown: próxima release / release atual / commit) e Archive (até escalar / por N eventos / por N usuários / para sempre), bookmark, share.
- [ ] **Navegação de eventos** — Recommended / First / Latest / Prev / Next; aba "All Events" paginada (hoje 50 fixos, `issue.service.ts:215`).
- [ ] **Tag summary** — barras de distribuição para todas as tags (browser, os, url, release, env, user…) com link para a busca; aba "Tags".
- [ ] **Stack trace** — toggle In App / Full, frames colapsáveis, número de linha com a linha do crash destacada, `vars` locais, raw/minified, badge `mechanism`/`handled`, ordem das exceções encadeadas (mais externa primeiro).
- [ ] **Contexts como cards** — Browser, OS, Device, Runtime, Trace, User, Request (hoje JSON cru em `IssueDetail.tsx:737`); breadcrumbs com filtro por tipo/nível e busca.
- [ ] **Extras do detalhe** — attachments (API + download; hoje são gravados e nunca exibidos), replay embutido, preview do trace, Activity + comentários, abas Merged / Similar; issue `merged` redireciona para a issue destino; "Desmesclar" só quando há merge.
- [ ] **Visual** — level como barra/marcador colorido à esquerda; fatal vermelho, error laranja-avermelhado (hoje fuchsia, `LevelBadge.tsx:2`); remover emojis da UI.

## Fase 19 — Workflow de issues (P2)

- [ ] **Substatus** — `new`, `ongoing`, `regressed`, `escalating`, `archived_until_escalating`, `archived_until_condition_met`, `archived_forever`; ignore → **Archive** na UI e na API.
- [ ] **Escalating** — detecção por pico em relação à média histórica (reaproveitar a lógica de spike dos alertas).
- [ ] **Resolve in next release / in release / in commit** — regressão só quando o evento vem de release posterior.
- [ ] **Archive por condição** — N ocorrências, N usuários, em janela.
- [ ] **User count** por issue (`user.id`/`email`/`ip`) — também alimenta sort, coluna e alertas.
- [ ] **Assignee real** (usuário/time, não texto livre), bookmark, subscribe, Activity log (quem mudou o quê) e comentários.
- [ ] **Unmerge por hash** (`/issues/:id/hashes/`).

## Fase 20 — API `/api/0/` compatível (P2)

Objetivo: scripts, integrações e o próprio `sentry-cli` funcionarem sem saber que não é o Sentry. O `/v1` do dashboard pode virar um alias fino sobre os mesmos controllers.

- [ ] **Identificadores** — slug de org e de projeto (coluna `slug`), `shortId` (`PROJ-1A`) por projeto, `permalink`.
- [ ] **Shapes** — Issue (`id` string, `shortId`, `title`, `culprit`, `permalink`, `level`, `status`, `statusDetails`, `substatus`, `priority`, `count` string, `userCount`, `firstSeen`, `lastSeen`, `project{}`, `metadata`, `type`, `issueCategory`, `isBookmarked`, `assignedTo`); Event com `entries[]` (`exception`, `breadcrumbs`, `request`, `message`), `tags: [{key,value}]`, `contexts`, `user`, `sdk`.
- [ ] **Paginação** — header `Link` com `rel="next"; results="true"; cursor="..."`.
- [ ] **Endpoints** — `GET /api/0/`; organizations/projects (list, detail); `/organizations/:org/issues/` (GET/PUT/DELETE bulk); `/issues/:id/` (GET/PUT/DELETE); `/issues/:id/events/{latest,oldest,recommended}/`; `/issues/:id/tags/:key/values/`; `/projects/:org/:proj/events/`; `/projects/:org/:proj/keys/`; environments; user-feedback; `/organizations/:org/stats_v2/`.
- [ ] **Query params** — `query` (sintaxe de busca), `statsPeriod`, `start`/`end`, `sort`, `environment`, `project`.
- [ ] **Docs** — corrigir drift em `apps/docs/.../api.md` (`/resolve|unresolve|ignore` → `/status`, 2FA, download de release files).

## Fase 21 — Alertas no modelo do Sentry (P2)

- [ ] **Issue alerts When / If / Then** — conditions (primeira vez, regressão, escalating, N eventos/usuários em janela) + filters (level, env, tag, release, idade) + actions (webhook/Slack/Discord) + `frequency` (intervalo de ação, hoje dedupe fixo de 24h em `alert.service.ts:120`). Migrar os 6 tipos fixos para esse modelo.
- [ ] **Edição** de regra e página de detalhe/histórico por regra.
- [ ] **Metric alerts** — limiar sobre contagem de erros, taxa de falha, p95, crash-free; estados critical/warning/resolved.
- [ ] **Payload compatível** — webhook genérico no formato de internal integration do Sentry (`action`, `data.issue`/`data.event`, `installation`, `actor`), para reaproveitar receivers existentes.

## Fase 22 — Release health, performance, replays e stats (P2/P3)

- [ ] **Release health** — crash-free sessions **e users**, adoption, colunas na lista de releases, detalhe na URL.
- [ ] **Performance/Insights** — p75 de duração, Apdex, failure rate excluindo `cancelled`/`unknown`, thresholds de web vitals good/meh/poor (hoje 2 estados), janela de tempo nas agregações (`performance.service.ts:69` varre tudo), waterfall com aninhamento pai/filho + painel de span, split Frontend/Backend.
- [ ] **Replays** — playback pelos timestamps reais com velocidade, aplicar mouse/scroll/input (`lib/replay.ts:237`), abas Console / Network / Breadcrumbs / Errors / Tags, `error_ids` como links, endpoint issue → replays, lista paginada com user/browser/OS/erros e busca.
- [ ] **Crons** — monitors a partir de `check_in` (Fase 15), com alerta de missed/failed.
- [ ] **Stats da org** — accepted / filtered / rate_limited / dropped por categoria (dados dos outcomes da Fase 15).

## Fase 23 — Organização, acesso e dados (P1/P2)

- [ ] **Inbound filters** (P1) — browser extensions, localhost, legacy browsers, web crawlers, error message (glob), releases; contabilizados como `filtered`.
- [ ] **Scrubbing de PII no servidor** (P1) — o Relay faz por padrão: `password`, `secret`, `token`, `authorization`, `cookie`, cartões de crédito, IP opcional; configurável por projeto (safe fields / campos extras).
- [ ] **Client keys** (P2) — várias keys por projeto, secret key, enable/disable, rate limit por key, rotação com período de graça (hoje troca seca, `project.service.ts:76`); página "Client Keys (DSN)" em Settings.
- [ ] **Roles e times** (P2) — owner / manager / admin / member, times com acesso por projeto.
- [ ] **Escopos de token** (P2) — `project:read`, `project:write`, `project:releases`, `event:read`, `event:write`, `org:read`…; token de CI do `sentry-cli` só com `project:releases`; expiração opcional.
- [ ] **Settings no lugar do Sentry** (P2) — project settings saem do Sheet da página de issues para Settings › Projects › General / Client Keys / Inbound Filters / Security & Privacy; onboarding com seletor de plataforma; 2FA com QR code; botão de copiar no token novo.

## Transversal

- [ ] **AGENTS.md** — corrigir regras que perpetuam bugs: header `60000:` (§5), "deflate é raw" (§5/§8); registrar o formato real do `replay_recording` e do upload do `sentry-cli`.
- [ ] **Fixtures reais em vez de formatos inventados** — regra: todo teste de protocolo usa payload capturado de SDK oficial (`test/fixtures/`), com a versão do SDK no nome do arquivo.
- [ ] **Teste E2E com SDKs** — job opcional que sobe a API e roda `@sentry/node`, `sentry-python` e `sentry-cli` reais contra ela.
- [ ] **pt-BR consistente** — "event id", "Role/owner/member", "Span/Timeline/Dur.", "Webhook URL", status `ok` cru, "erro tracking" (typo em `Overview.tsx:85`); níveis traduzidos como as prioridades.
- [ ] **Infra pendente** (herdado) — migrações com drizzle-kit, backup do SQLite (`VACUUM INTO`), métricas do próprio servidor em `/health`, rate limit global por IP.

---

## Não-objetivos (decisões conscientes)

| Feature do Sentry                                           | Por quê não                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Kafka / ClickHouse / workers                                | Proposta central: micro VPS, 1 processo, zero infra                                  |
| Horizontal scaling / multi-region                           | Não é o público-alvo                                                                 |
| Simbolização nativa (DIF, PDB, dSYM, ProGuard)              | Exige symbolicator + armazenamento de debug files; minidump vira evento sem símbolos |
| Profiling (flamegraphs, `profile`/`profile_chunk`)          | Volume e UI pesados; aceitar e descartar com outcome até haver demanda               |
| Discover / Dashboards customizáveis completos               | Query engine genérico fora de proporção para SQLite; Explore cobre os casos comuns   |
| Replay por longos períodos                                  | Volume inviável em SQLite — expiração de 7d                                          |
| ML grouping / Similar por embeddings / Seer                 | Fora de proporção; "Similar" por fingerprint/frames                                  |
| Quotas/planos de faturamento                                | Sem SaaS, sem billing                                                                |
| Integrações completas (Jira, Linear, Slack app, GitHub app) | Via webhooks genéricos no formato do Sentry                                          |
| Email, SSO                                                  | Sem infra SMTP; senha + 2FA cobrem self-host de poucos usuários                      |

---

## Como priorizar na prática

1. **F11 ✅ → F12 → F13 em sequência** — segurança, SDKs funcionando, dados íntegros. Cada um termina com testes que falhavam antes.
2. **F14 antes de qualquer UI de issues** — não adianta tela bonita com issues mal agrupadas.
3. **F16 e F17 podem andar em paralelo** — backend de sourcemaps e fundação de UI não se tocam.
4. **F18 depende de F17** (URL/page filters) e parcialmente de F19/F20 (substatus, user count, tags) — entregar a UI incrementalmente conforme o backend chega.
5. **F20 (API `/api/0`) é o maior bloco** — começar pelo que o `sentry-cli` e integrações usam (releases, keys, issues).
6. **Cada fase termina deployável** — nada de quebrar `docker compose up` no meio do caminho.
