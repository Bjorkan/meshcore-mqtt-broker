# API Development Guide

This document describes how HTTP API endpoints are structured in this codebase and provides patterns for adding new endpoints.

## 1. HTTP Server Architecture

There is **no HTTP framework** (no Express, no Fastify). The project uses raw Node.js `http.createServer` in `src/dashboard.ts`. The HTTP server runs in the same process as the MQTT broker.

### Request handling pattern

All routes are handled inside a single `createServer` callback via `void (async () => { ... })()`:

```typescript
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end();
      return;
    }
    // ... route matching ...
  })();
});
```

### Adding a new route

Add an `if` block inside the `createServer` callback in `src/dashboard.ts` (line ~1786). Match on `url.pathname`. For static paths, use `===`. For parameterized paths, use `startsWith` and split the pathname:

```typescript
// Static route:
if (url.pathname === "/api/dashboard") { ... }

// Parameterized route:
if (url.pathname.startsWith("/api/v1/observers/")) {
  const parts = url.pathname.split("/");
  const publicKey = decodeURIComponent(parts[parts.indexOf("observers") + 1]);
  // ...
}
```

## 2. Response Helpers

Available in `src/dashboard.ts`:

```typescript
// 200 with JSON content-type and no-store cache
function sendJson(res: ServerResponse, value: unknown): void;

// 200 with text/html
function sendHtml(res: ServerResponse, html: string): void;

// 404 with text/plain
function notFound(res: ServerResponse): void;

// 200 with image/svg+xml (cached 24h)
function sendFavicon(res: ServerResponse): void;
```

For non-200 responses, write the head and body manually:

```typescript
res.writeHead(400, {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});
res.end(JSON.stringify({ status: "invalid", message: "..." }));
```

### Content types

- JSON responses: `application/json; charset=utf-8`
- Always set `cache-control: no-store` for API responses that reflect live state.
- For static assets (favicon), `cache-control: public, max-age=86400` is acceptable.

## 3. Data Flow: Valkey via ClusterStateStore

The `ClusterStateStore` (defined in `src/orchestration.ts`) is the single source of truth for all cluster state. API endpoints **must not** read from local in-memory state if the data needs to be cluster-consistent.

### Available data sources

| Method                                           | Returns                      | Use for                                       |
| ------------------------------------------------ | ---------------------------- | --------------------------------------------- |
| `clusterStateStore.listPublicBans()`             | `PublicBanSummary[]`         | Muted/would_mute bans                         |
| `clusterStateStore.countActivePublicBans()`      | `number`                     | Exact count of active enforced mutes          |
| `clusterStateStore.listDeniedPublishes()`        | `PublicBanSummary[]`         | Denied publish events (status: "denied")      |
| `clusterStateStore.listInstanceObservers()`      | `InstanceObserverEntry[]`    | Active/passive observers across all instances |
| `clusterStateStore.getObserverNodeNames(keys[])` | `Map<publicKey, name>`       | Human-readable names for public keys          |
| `clusterStateStore.listInstanceMetrics()`        | `DashboardInstanceMetrics[]` | Per-broker health and throughput              |
| `clusterStateStore.listInstanceReadiness()`      | `ClusterInstanceReadiness[]` | Which instances are healthy                   |

### PublicBanSummary shape

```typescript
interface PublicBanSummary {
  node: string; // Uppercase public key
  label?: string; // Human-readable name
  broker: string; // Which broker decided
  reason: string; // Free-text reason (e.g., "Avvikelsegräns")
  blockCount: number; // Escalation count (1, 2, 3+)
  mutedUntil?: number; // Unix ms timestamp
  status: "muted" | "would_mute" | "denied";
  lastUpdatedAt?: number;
  topic?: string; // Only on denied publishes
  region?: string; // Only on denied publishes
  deniedUntilText?: string; // Human-readable IATA correction date
}
```

### InstanceObserverEntry shape

```typescript
interface InstanceObserverEntry {
  label: string;
  publicKey: string;
  broker: string;
  region?: string;
  active: boolean;
  lastConnectedAt: number;
  lastSeenAt: number;
  messageCount: number;
  messages: InstanceObserverMessage[];
}
```

## 4. Public Key Handling

### normalizePublicKey(publicKey) → string

In `src/orchestration.ts`. Trims whitespace and converts to uppercase. **Always apply normalization before comparisons or lookups.**

```typescript
export function normalizePublicKey(publicKey: string): string {
  return publicKey.trim().toUpperCase();
}
```

### validatePublicKey(input) → string | null

In `src/orchestration.ts`. Returns the normalized valid key or null if invalid.

**Validation rules:**

- Trim input first
- Reject if >128 characters (prevents DoS with oversized input)
- Must match exactly 64 uppercase hex characters: `/^[0-9A-F]{64}$/`
- Returns the normalized (uppercase) key on success

```typescript
export function validatePublicKey(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length > 128) return null;
  const uppered = trimmed.toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(uppered)) return null;
  return uppered;
}
```

### shortKey(publicKey) → string

In `src/dashboard.ts`. Used for display truncation:

```typescript
function shortKey(publicKey: string): string {
  if (publicKey.length <= 18) return publicKey;
  return `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}`;
}
```

## 5. Observer Lookup Pattern

The `lookupObserverStatus()` function in `src/dashboard.ts` demonstrates the pattern for combining multiple Valkey data sources:

```typescript
async function lookupObserverStatus(
  publicKey: string,
  clusterStateStore: ClusterStateStore,
): Promise<ObserverStatus> {
  const normalized = normalizePublicKey(publicKey);

  const [bans, deniedPublishes, observerEntries, nodeNames] = await Promise.all([
    clusterStateStore.listPublicBans(200),
    clusterStateStore.listDeniedPublishes(200),
    clusterStateStore.listInstanceObservers(),
    clusterStateStore.getObserverNodeNames([normalized]),
  ]);

  const denialEvents = [...bans, ...deniedPublishes];
  const blockMatch = denialEvents.find(e => e.node.toUpperCase() === normalized);

  if (blockMatch) { return { status: "blocked", ... }; }
  // else check observerEntries, else return unknown
}
```

**Priority rules (must not change):**

1. Blocked always wins over known
2. Known only if not blocked
3. Unknown if neither

## 6. Response Format Conventions

### Success responses (200)

Use `sendJson(res, data)`. The response body is a JSON object.

### Error responses (400/500)

Write manually:

```typescript
res.writeHead(400, {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});
res.end(JSON.stringify({ status: "invalid", message: "..." }));
```

### Error handling pattern

Wrap the endpoint logic in try/catch. Log the real error to console (server-side only) but return only a sanitized message:

```typescript
try {
  const result = await doLookup(...);
  sendJson(res, result);
} catch (error) {
  console.error("[API] Error:", error instanceof Error ? error.message : String(error));
  res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ status: "error", message: "..." }));
}
```

### What NOT to return

- Internal tokens, JWT, or secrets
- Valkey/Redis keys or connection strings
- Stack traces
- Client IP addresses
- Raw packet payloads
- `/internal` or `/serial` topic data
- File system paths

## 7. URL Parameter Handling

### Path parameters

Use `url.pathname.split("/")`:

```typescript
const parts = url.pathname.split("/");
const idx = parts.indexOf("observers") + 1;
const rawParam = parts[idx];
const decoded = decodeURIComponent(rawParam);
```

Always wrap `decodeURIComponent` in try/catch — malformed encoded strings can throw.

### Query parameters

Use the standard `URL` API:

```typescript
const url = new URL(req.url || "/", "http://localhost");
const query = url.searchParams.get("q") || "";
```

## 8. CORS Handling

**No CORS headers are currently set.** The dashboard client and API are served from the same origin by default.

If a new endpoint needs cross-origin access, add CORS headers before the response body:

```typescript
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
```

Handle `OPTIONS` preflight requests at the top of the handler:

```typescript
if (req.method === "OPTIONS") {
  res.writeHead(204, {/* CORS headers */});
  res.end();
  return;
}
```

## 9. Testing API Endpoints

### Integration tests (with Valkey)

Test files are `.mjs` ESM modules in `tests/`. Pattern for API endpoint tests:

```javascript
import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { ClusterStateStore } from "../dist/orchestration.js";
import { lookupObserverStatus } from "../dist/dashboard.js";

function kvUrl() {
  return process.env.TEST_BROKER_KV_URL || "redis://127.0.0.1:6379";
}

const stores = [];
function createStore(instanceId, namespace) {
  const store = new ClusterStateStore({ kvUrl: kvUrl(), namespace, instanceId });
  stores.push(store);
  return store;
}

afterEach(async () => {
  for (const store of stores) {
    try { await store.close(); } catch { /* ignore */ }
  }
  stores.length = 0;
});

test("lookup returns known for active observer", async () => {
  const store = createStore("broker-alpha", testNamespace());
  await store.ready();
  const pk = publicKey("A");

  await store.setInstanceObservers([{ publicKey: pk, ... }]);
  await store.setObserverNodeName(pk, "My Observer", 86_400_000);

  const result = await lookupObserverStatus(pk, store);
  assert.equal(result.status, "known");
});
```

### Source regression tests

For UI components and CSS, source-based regression tests verify that specific patterns exist in the source code:

```javascript
test("component uses correct CSS class", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("detail-grid-dl"), "must use detail-grid-dl class");
});

test("CSS has mobile breakpoint for detail grid", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(
      "detail-grid, .detail-grid.compact { grid-template-columns: 1fr; }",
    ),
    "mobile must set detail-grid to single column",
  );
});
```

## 10. Key Files Reference

| When adding/changing         | Edit this file                                                       | Test file                                                      |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| HTTP endpoint (internal)     | `src/dashboard.ts` (add route in `createDashboardServer`)            | Tests that call the endpoint or the underlying lookup function |
| HTTP endpoint (public)       | `src/dashboard.ts` (add route) + `README.md` (document)              | `tests/observer-api.test.mjs` or new test file                 |
| Valkey data model            | `src/orchestration.ts` (add/get/list methods on `ClusterStateStore`) | `tests/observer-claim.test.mjs` or new test file               |
| Dashboard React component    | `src/dashboard-client.tsx` (add component, integrate in App)         | `tests/dashboard-helpers.test.mjs` (source checks)             |
| Dashboard CSS/layout         | `src/dashboard.ts` (in `renderDashboardHtml` style block)            | `tests/dashboard-helpers.test.mjs` (CSS regression checks)     |
| Dashboard display helpers    | `src/dashboard-helpers.ts` (add function)                            | `tests/dashboard-helpers.test.mjs` (unit tests)                |
| Key normalization/validation | `src/orchestration.ts` (add helper, export)                          | `tests/observer-api.test.mjs` (unit tests)                     |

## 11. Build and Run

```bash
npm run build   # TypeScript compile + esbuild dashboard-client
npm test        # Full test suite (requires Valkey on localhost:6379)
```

The dashboard HTTP server runs on the port configured via `dashboard.port` in `config.yaml` (default 8080). It starts as part of `startBrokerServer()` in `src/server.ts`.
