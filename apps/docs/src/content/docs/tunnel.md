---
title: Tunnel para browsers
description: Drible ad-blockers enviando o envelope pelo proxy do sentrylike.
---

Ad-blockers e extensões de privacidade bloqueiam os endpoints diretos de telemetria. O Sentry resolve isso com o **tunnel**: o SDK envia o envelope para o seu próprio domínio (`/api/tunnel`), e o servidor repassa para o backend.

O sentrylike implementa esse endpoint — o SDK de browser envia o envelope completo no corpo, com o **DSN no header do envelope** (é assim que o servidor descobre o projeto, pela key).

## Configuração no browser SDK

```js
Sentry.init({
  dsn: "http://<key>@localhost:3001/1",
  tunnel: "/api/tunnel", // caminho no seu domínio, sem o host
});
```

Como o tunnel é servido pelo próprio sentrylike (`POST /api/tunnel`), nenhum proxy extra é necessário.

## Requisitos

- O `Origin` da página deve estar em `allowed_domains` do projeto (ou a lista vazia)
- O envelope precisa do DSN completo no header
