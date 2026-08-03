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

## Web vitals por release

A página de release compara web vitals entre deploys, junto com o crash-free.

## Sessões & crash-free

- Sessões por release (status crashed/abnormal) com série temporal diária
- Card crash-free + série de 14 dias colorida por saúde:
  - ≥99% verde
  - ≥95% âmbar
  - senão vermelho
