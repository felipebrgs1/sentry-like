/**
 * Sends a demo error event to a sentrylike instance.
 * Usage: bun run demo:event [dsn]
 * Defaults to http://<demo-key>@localhost:3001/1 — get the key from the API logs
 * or pass the full DSN shown in the dashboard.
 */
const dsn = process.argv[2] ?? "http://localhost:3001/1";
const url = new URL(dsn);
const projectId = url.pathname.replace(/^\//, "");
const publicKey = url.username;

const event = {
  event_id: crypto.randomUUID().replace(/-/g, ""),
  timestamp: Date.now() / 1000,
  platform: "javascript",
  level: "error",
  message: "Evento de teste do sentrylike",
  exception: {
    values: [
      {
        type: "DemoError",
        value: `Algo explodiu às ${new Date().toLocaleTimeString()}`,
        stacktrace: {
          frames: [
            { filename: "app.js", function: "main", lineno: 10, in_app: true },
            { filename: "checkout.js", function: "processPayment", lineno: 84, in_app: true },
            { filename: "demo.js", function: "explode", lineno: 42, in_app: true },
          ],
        },
      },
    ],
  },
  tags: { environment: "demo", release: "0.1.0" },
  breadcrumbs: [
    { timestamp: Date.now() / 1000 - 5, category: "ui.click", message: "clicou em 'Pagar'" },
    { timestamp: Date.now() / 1000 - 2, category: "http", message: "POST /checkout → 500" },
  ],
  user: { id: "42", email: "demo@example.com" },
};

const payload = JSON.stringify(event);
const payloadBytes = new TextEncoder().encode(payload);
const envelope =
  `${JSON.stringify({ event_id: event.event_id, dsn })}\n` +
  `${JSON.stringify({ type: "event", content_type: "application/json", length: payloadBytes.length })}\n` +
  payload;

const res = await fetch(`${url.origin}/api/${projectId}/envelope/`, {
  method: "POST",
  headers: {
    "content-type": "application/x-sentry-envelope",
    "x-sentry-auth": `Sentry sentry_version=7, sentry_client=sentrylike-demo/0.1, sentry_key=${publicKey}`,
  },
  body: envelope,
});

console.log(res.status, await res.text());
