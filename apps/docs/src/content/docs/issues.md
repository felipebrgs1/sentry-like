---
title: Issues & grouping
description: Como o sentrylike agrupa erros em issues e o que dá para fazer com elas.
---

O coração do produto: eventos parecidos viram **issues** com contexto e ciclo de vida.

## Grouping (fingerprint)

O agrupamento usa um fingerprint por issue:

1. **Fingerprint custom** — `event.fingerprint` enviado pelo SDK é respeitado
2. **Tipo + frames in-app** — hash do tipo de exceção e dos frames marcados como `in_app`
3. **Frames simbolizados** — se a release tem sourcemaps (F8), o fingerprint usa o código-fonte original: `app.js` e `app.js?v=2` agrupam na mesma issue

## Ciclo de vida

| Status       | Significado                                                                           |
| ------------ | ------------------------------------------------------------------------------------- |
| `unresolved` | aberta, aparece na listagem padrão                                                    |
| `resolved`   | resolvida; novo evento reabre com **badge de regressão**                              |
| `ignored`    | ignorada; suporta **janela de tempo** (`ignored_until`) — expirada, conta como aberta |

## Ações

- **Resolver / ignorar** (com janela de 30m / 1h / 24h)
- **Merge / unmerge** — juntar issues manualmente; cada evento guarda a issue original (`original_issue_id`) para desfazer
- **Ações em lote** — selecionar várias issues e resolver/ignorar/marcar vistas/deletar/mesclar
- **Prioridade** — scoring (nível × frequência × recência) com labels low/medium/high
- **Atribuição** — `assigned_to` (texto livre)
- **Mark as seen / unread** — indicador de não-lida

## Busca e listagem

- Filtros: título, nível, ambiente, release
- **Search salva** — combinações de filtro como views por projeto
- **Paginação com cursor** — base64 `(lastSeen, id)`, "carregar mais"

## Detalhe da issue

Stacktrace (com contexto de código quando há sourcemaps), breadcrumbs, tags, contexts, JSON raw, frequência, distribuição por ambiente/release, e feedback dos usuários.
