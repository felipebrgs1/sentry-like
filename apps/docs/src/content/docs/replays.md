---
title: Replays
description: Session replay com player básico — reconstrução do DOM, interações e expiração de 7 dias.
---

O replay captura a sessão do usuário (DOM, cliques, inputs) para você "ver" o que aconteceu antes do erro.

## Como funciona

1. O SDK (`@sentry/replay`) envia items `replay_event` (metadados: urls, erros, user) e `replay_recording` (segmentos de eventos rrweb) no envelope
2. Cada recording vira um segmento em `replay_recordings` — **idempotente por `(replay_id, segment_id)`**, com o conteúdo no BlobStore (disco/R2)
3. O player (`/replays/:id`) reconstrói o DOM a partir dos eventos rrweb e mostra a linha do tempo

## Player

- **Reconstrução do DOM** — FullSnapshot + mutations (texto, atributo, adição/remoção/movimento de nós), com **sanitização anti-XSS**: tags e atributos perigosos são bloqueados (os dados vêm de SDKs de terceiros)
- **Slider temporal** com play/pause e step
- **Timeline de interações** — cliques (com posição x/y), inputs e scroll; clicar num item navega até o momento
- Viewport escalado (o SDK declara largura/altura no evento Meta)

## Expiracão

> **Decisão consciente (roadmap F9)**: replay em SQLite é inviável para volumes grandes.

Segmentos ficam em disco e expiram em **7 dias** (`REPLAY_RETENTION_DAYS`), limpos pelo `runRetention` — que apaga também os blobs.

## DSN

O replay é ativado no SDK do browser:

```js
Sentry.init({
  dsn: "http://<key>@localhost:3001/1",
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [new Sentry.Replay()],
});
```
