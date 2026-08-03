---
title: SDKs
description: Aponte os SDKs oficiais do Sentry para o sentrylike trocando apenas o DSN.
---

Qualquer SDK oficial do Sentry funciona: troque o DSN pela URL do seu servidor e pronto.

## Formato do DSN

```text
http://<public_key>@<host>:<port>/<project_id>
```

A public key e o project id estão no dashboard em **Projetos** (ou no primeiro boot do seed).

## JavaScript / React

```js
// npm install --save @sentry/browser
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "http://<key>@localhost:3001/1",
  environment: "production",
  release: "web@1.0.0",
});

Sentry.captureException(new Error("primeiro erro!"));
```

No React, use `@sentry/react` com `Sentry.ErrorBoundary` para capturar erros de renderização.

## Vue

```js
import * as Sentry from "@sentry/vue";

Sentry.init({
  app,
  dsn: "http://<key>@localhost:3001/1",
  environment: "production",
});
```

## Python

```python
# pip install sentry-sdk
import sentry_sdk

sentry_sdk.init(
    dsn="http://<key>@localhost:3001/1",
    environment="production",
    release="web@1.0.0",
)
```

## PHP

```php
# composer require sentry/sentry
Sentry\init([
  'dsn' => 'http://<key>@localhost:3001/1',
  'environment' => 'production',
]);
```

## Ruby

```ruby
# gem install sentry-ruby
Sentry.init do |config|
  config.dsn = 'http://<key>@localhost:3001/1'
  config.environment = 'production'
end
```

## Enviar um evento de teste sem SDK

```bash
bun scripts/send-test-event.ts "http://<key>@localhost:3001/1"
```
