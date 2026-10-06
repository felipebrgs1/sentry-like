---
title: Releases
description: Auto-descoberta de releases, comparação de deploys e environments.
---

Releases são **auto-descobertas**: a primeira vez que um evento/transaction/sessão chega com um `release`, ele aparece na lista.

## Página de release

- Lista com ambientes, commits, latência (avg/p95) e erros
- **Issues novas na release** — primeiro evento com aquela release
- Distribuição por ambiente/release no detalhe da issue

## Ciclo de release

- **Comparação lado a lado** entre releases: eventos, issues novas, latência, erro
- **Webhook de deploy** — GitHub/GitLab push (refs/tags) marca deploy com commits

### Webhook de deploy (assinado)

`POST /v1/webhooks/releases/:projectId` é público (server-to-server), então **exige o segredo do projeto**. O owner gera/rotaciona o segredo em _Configurações do projeto → Webhook de deploy_ (projetos criados antes desta versão começam sem segredo = webhook desativado).

| Origem  | Como autenticar                                                                       |
| ------- | ------------------------------------------------------------------------------------- |
| GitHub  | campo **Secret** do webhook (content type `application/json`) → `X-Hub-Signature-256` |
| GitLab  | campo **Secret token** → `X-Gitlab-Token`                                             |
| CI/curl | header `X-Sentrylike-Token: <segredo>`                                                |

Sem assinatura válida → `401`.

## Web vitals por release

A página de release compara web vitals entre deploys, junto com o crash-free.

## Sessões & crash-free

- Sessões por release (status crashed/abnormal) com série temporal diária
- Card crash-free + série de 14 dias colorida por saúde:
  - ≥99% verde
  - ≥95% âmbar
  - senão vermelho
