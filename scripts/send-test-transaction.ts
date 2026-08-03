/**
 * Sends demo transaction events (performance) to a sentrylike instance.
 * Usage: bun run demo:transaction [dsn] [count]
 * Defaults to http://localhost:3001/1 — get the demo key from the API logs.
 */
const dsn = process.argv[2] ?? "http://localhost:3001/1";
const count = Number(process.argv[3] ?? 20);
const url = new URL(dsn);
const projectId = url.pathname.replace(/^\//, "");
const publicKey = url.username;
if (!publicKey) {
  console.error(
    "O DSN precisa da key: https://<public_key>@host/<project_id> (pegue em /v1/projects)",
  );
  process.exit(1);
}
const base = `${url.protocol}//${url.host}`;

const routes = [
  "/api/users",
  "/api/checkout",
  "/api/products",
  "/api/search",
  "/app/dashboard",
  "/app/settings",
];

for (let i = 0; i < count; i++) {
  const name = routes[i % routes.length];
  const start = Date.now() - Math.floor(Math.random() * 3_600_000);
  const dbMs = 20 + Math.floor(Math.random() * 300);
  const httpMs = 50 + Math.floor(Math.random() * 800);
  const totalMs = dbMs + httpMs + 10 + Math.floor(Math.random() * 120);
  const ok = Math.random() > 0.08;
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const dbSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const httpSpanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const lcp = 800 + Math.random() * 2400;
  const cls = Math.random() * 0.15;

  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    type: "transaction",
    transaction: name,
    timestamp: (start + totalMs) / 1000,
    start_timestamp: start / 1000,
    platform: "javascript",
    release: `1.${i % 4}.0`,
    environment: i % 5 === 0 ? "staging" : "production",
    contexts: {
      trace: {
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: null,
        op: "pageload",
        status: ok ? "ok" : "internal_error",
      },
      browser: { name: "Chrome", version: "126.0" },
      device: { family: "Desktop" },
    },
    measurements: {
      lcp: { value: Math.round(lcp), unit: "millisecond" },
      fcp: { value: Math.round(lcp * 0.7), unit: "millisecond" },
      cls: { value: cls, unit: "" },
      ttfb: { value: Math.round(80 + Math.random() * 400), unit: "millisecond" },
      inp: { value: Math.round(60 + Math.random() * 240), unit: "millisecond" },
    },
    spans: [
      {
        span_id: dbSpanId,
        trace_id: traceId,
        parent_span_id: spanId,
        op: "db.query",
        description: "SELECT * FROM orders WHERE user_id = ?",
        start_timestamp: start / 1000 + 0.005,
        timestamp: (start + dbMs) / 1000,
        status: "ok",
      },
      {
        span_id: httpSpanId,
        trace_id: traceId,
        parent_span_id: spanId,
        op: "http.client",
        description: `POST https://internal.api${name}`,
        start_timestamp: (start + dbMs) / 1000 + 0.002,
        timestamp: (start + dbMs + httpMs) / 1000,
        status: ok ? "ok" : "internal_error",
      },
    ],
    request: { url: `https://app.example.com${name}`, method: "GET" },
    user: { id: String(1 + (i % 50)), geo: { country_code: "BR" } },
  };

  const res = await fetch(`${base}/api/${projectId}/store/?sentry_key=${publicKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const body = (await res.json()) as { id?: string };
  console.log(
    `${res.status} ${name.padEnd(16)} ${totalMs}ms ${ok ? "ok" : "error"} id=${body.id ?? "?"}`,
  );
}

console.log(`\nEnviadas ${count} transações para ${dsn}`);
