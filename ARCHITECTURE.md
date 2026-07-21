# Architecture Overview

This is the living architecture document for the MeshCore MQTT broker fork. Update it whenever configuration, deployment, MQTT behavior, Valkey state, dashboard data, healthchecks, CLI, abuse handling, target forwarding, or API behavior changes.

## 1. Project Structure

```text
[Project Root]/
├── src/
│   ├── server.ts             # Aedes/WebSocket MQTT runtime, auth, topic authorization
│   ├── config.ts             # Read-only config.yaml loader, validation, settings paths
│   ├── orchestration.ts      # Valkey cluster state store, observer claims, trust state
│   ├── dashboard.ts          # Dashboard HTTP server + public observer status API
│   ├── dashboard-client.tsx  # React SPA: brokers, observers, bans, lookup, publish feed
│   ├── dashboard-helpers.ts  # Shared helpers: region/denial formatting, time display
│   ├── aedes-types.ts        # TypeScript types extending Aedes Client for publisher/subscriber
│   ├── abuse-detector.ts     # Rate limiting, duplicate detection, anomaly, shadow/enforcement
│   ├── target-bridge.ts      # Integrated forwarding to another MQTT broker via mqtt.js
│   ├── meshcore-io-runtime.ts # Valkey leader election, durable ingress/upload queues, workers
│   ├── meshcore-io-poster.ts  # Signed Meshcore.io API uploader with timeout handling
│   ├── meshcore-io-utils.ts   # Advert/radio parsing and validation helpers
│   ├── healthcheck.ts        # MQTT raw-packet loopback + Valkey readiness healthcheck
│   ├── healthcheck-loopback.ts # Constants for the loopback healthcheck topic/payload
│   ├── docker-health-user.ts # Runtime-generated docker_health credentials file (not config)
│   ├── heartbeat.ts          # Broker heartbeat topic, message, and interval constants
│   ├── instance-id.ts        # Broker instance ID generation, persistence, formatting
│   ├── ip-utils.ts           # Client IP extraction with Cloudflare/proxy header support
│   ├── logger.ts             # Swedish console logger with log levels, coloring, timestamps
│   ├── rate-limiter.ts       # Simple IP-based connection rate limiter with block windows
│   ├── swedish-counties.ts   # Swedish county/IATA lookup with HTTP fetch + local fallback
│   └── cli.ts                # mc-mqtt CLI: status, observer list, abuse management, reset
├── tests/                    # Jest ESM test suites (.mjs), 16 suites, ~300 tests
│   ├── observer-api.test.mjs        # Public observer-status API and key validation
│   ├── broker-runtime.test.mjs      # MQTT auth, publish/subscribe, topic authorization
│   ├── abuse-detector.test.mjs      # Rate/duplicate/anomaly detection and shadow mode
│   ├── observer-claim.test.mjs      # Observer ownership claims across broker instances
│   ├── orchestration-runtime.test.mjs # Valkey adapter timeouts and error-event handling
│   ├── subscriber-list.test.mjs     # Cluster subscriber connection summaries
│   ├── cli.test.mjs                 # CLI status, observer list, abuse, reset commands
│   ├── config.test.mjs              # Config.yaml loading and validation
│   ├── dashboard-helpers.test.mjs   # Helper functions + CSS/component source regression
│   ├── dashboard-state.test.mjs     # DashboardState snapshot building from Valkey
│   ├── healthcheck.test.mjs         # MQTT packet encoding and healthcheck options
│   ├── ip-utils.test.mjs            # Client IP extraction from proxy headers
│   ├── package-contract.test.mjs    # Package.json, tsconfig, jest, Dockerfile contracts
│   ├── rate-limiter.test.mjs         # Rate limiter threshold and block-window behavior
│   ├── swedish-counties.test.mjs    # County/IATA lookup, validation, HTTP fetch
│   └── target-bridge.test.mjs       # Target bridge forwarding policy
├── scripts/
│   ├── capture-dashboard-screenshots.mjs  # Playwright screenshot capture for PR review
│   └── seed-dashboard-demo.mjs            # Valkey data seeding for dashboard demos
├── config.yaml               # Read-only runtime configuration (example/defaults)
├── Dockerfile
├── compose.yaml.example
├── tsconfig.json
├── jest.config.mjs
├── eslint.config.mjs
├── .prettierrc
├── .editorconfig
├── AGENTS.md                 # Agent compatibility rules and documentation index
├── ARCHITECTURE.md           # This file
├── API_DEVELOPMENT.md        # Guide for adding API endpoints
└── README.md                 # User-facing project documentation + public API reference
```

## 2. High-Level System Diagram

```text
[MeshCore observer / publisher]
  │ MQTT over WebSocket, JWT auth (v1_{PUBLIC_KEY} / MeshCore JWT)
  ▼
[src/server.ts: Aedes broker]
  ├── reads read-only config.yaml through config.ts
  ├── authenticates publishers and subscriber accounts
  ├── validates topic, region, public key, payload, retain behavior
  ├── records abuse/trust state and denied events in Valkey
  ├── publishes public MQTT traffic to local/cluster subscribers
  ├── publishes broker-owned /internal telemetry for admins
  ├── optionally forwards claimed observer traffic to target MQTT
  └── periodically publishes heartbeat messages

[Valkey / Redis-compatible]
  ├── Aedes persistence and mq emitter (cluster routing)
  ├── broker readiness and metrics (short-lived)
  ├── subscriber connection limits
  ├── observer ownership claims (auto-expiring)
  ├── observer friendly names (cached with TTL)
  ├── abuse trust state (muted/would_mute, 90-day TTL)
  ├── Meshcore.io producer lease and observer radio-state cache
  ├── durable Meshcore.io ingress and upload streams with consumer groups
  └── short-lived denied publish events (24h TTL)

[Dashboard HTTP server (same process)]
  ├── /                    → HTML shell with embedded CSS
  ├── /api/dashboard       → JSON cluster snapshot (brokers, observers, bans)
  ├── /api/v1/observers/{publicKey}/status   → public read-only observer lookup
  ├── /favicon.svg         → SVG favicon
  └── /dashboard-client.js → bundled React SPA

[Dashboard React SPA (browser)]
  ├── Overview: metric cards, broker legend, publish feed, observer lookup
  ├── Brokers: broker table, broker modal with observer list
  ├── Observers: searchable/filterable observer table, observer modal, latest neighbor/scopes snapshot
  ├── Bans: denied publishes + trust-state bans table, ban modal
  ├── Meshcore.io: producer lease, shared queue, workers, totals, and history
  └── "Kontrollera din observatör": uppslagning av publik nyckel via det publika API:t

[mc-mqtt CLI]
  └── status, observer list, abuse list/remove/clearall, namespace reset

[Docker healthcheck]
  └── authenticates as runtime docker_health user, verifies MQTT loopback + Valkey readiness
```

## 3. Core Components

### 3.1. MQTT Broker Runtime (`src/server.ts`)

The primary service. Accepts MQTT over WebSocket, authenticates MeshCore publishers with `v1_{PUBLIC_KEY}` and MeshCore JWT passwords, authenticates read-only subscriber accounts from `config.yaml`, enforces publish/subscribe authorization, strips retained client publishes, and exposes a dashboard. It is intentionally close to upstream MQTT behavior for publisher topics and normal JSON payloads.

**Key functions:**

- Publisher auth: username `v1_{PUBLIC_KEY}`, password is MeshCore JWT signed for that key
- Publisher topic: `meshcore/{IATA_OR_TEST}/{PUBLIC_KEY}/{subtopic}`
- Publisher payload: valid JSON with `origin_id` matching the authenticated public key
- Neighbor payloads: firmware-compatible `/neighbors` JSON up to the 10 KiB observer buffer, parsed into bounded dashboard state
- Subscriber auth: username/password from `config.yaml subscribers.users`
- Subscriber roles: ADMIN (1), FULL_ACCESS (2), LIMITED (3)
- Retained client publishes are intentionally stripped
- Broker publishes heartbeat every 30s on `heartbeat/` topic
- `/internal`, `$SYS/*`, `/serial/*` are filtered for non-admin subscribers

Technologies: Node.js, TypeScript, Aedes, ws, @michaelhart/meshcore-decoder

Deployment: Docker image from `Dockerfile`, normally backed by Valkey. Docker Swarm can mount `config.yaml` as `/run/configs/meshcore-mqtt-broker-config.yaml`.

### 3.2. Configuration Loader (`src/config.ts`)

Loads all runtime settings from read-only YAML. The broker never writes to `config.yaml`. There is no `.env` compatibility layer; subscriber credentials are structured entries under `subscribers.users`.

**Search paths for config.yaml:**

- `config.yaml` (CWD)
- `broker/config.yaml`
- `/run/configs/meshcore-mqtt-broker-config.yaml`
- `/run/configs/config.yaml`
- Relative to source directory

**Key config sections:**

- `mqtt`: ws_port, host, ws_max_payload_bytes, json_publish_max_bytes
- `dashboard`: port
- `broker`: kv_url, kv_namespace, name, runtime_id_file, node_name_cache_ttl_ms
- `auth`: expected_audience
- `subscribers`: default_max_connections, users (username + password + role)
- `abuse`: enforcement_enabled, bucket_capacity, bucket_refill_rate, thresholds
- `target_mqtt`: URL, username, password, reconnect/connect settings
- `healthcheck`: mqtt_timeout_ms, mqtt_keepalive_seconds, valkey_timeout_ms, valkey_ready_max_age_ms
- `proxy`: trust_proxy, trusted_proxy_cidrs
- `allowed_regions`: YAML mapping keyed by IATA code, each with `friendly_name`

### 3.3. Orchestration and Valkey (`src/orchestration.ts`)

Valkey is required even for one broker replica. It provides Aedes cluster routing/persistence, subscriber connection limits, readiness, metrics, observer claims, friendly names, trust state, and denied publish event storage. Broker instance IDs are generated at startup and written to a local runtime file so dashboard, healthcheck, CLI, and target forwarding agree on identity. Valkey clients use finite connection and command timeouts so a half-open or non-responsive backend rejects work instead of leaving MQTT authorization, dashboard requests, or shutdown paths waiting indefinitely. Redis adapter and Aedes runtime error events are handled and logged rather than being allowed to terminate Node as unhandled `error` events.

A newly authenticated publisher connection may take over an existing observer claim so reconnects do not wait for the old claim TTL. Normal publish authorization only reclaims a missing claim; it never steals a claim from the newly authenticated owner. An older connection that has lost ownership is rejected and closed on its next publish.

**Key types:**

- `ClusterStateStore`: Main Valkey state manager
- `PublicBanSummary`: node, label, broker, reason, blockCount, mutedUntil, status, deniedUntilText
- `InstanceObserverEntry`: label, publicKey, broker, region, active, lastConnectedAt, lastSeenAt, messageCount, messages
- `DashboardInstanceMetrics`: Per-broker metrics including targetBridge status
- `DeniedPublishInput`: node, label, reason, topic, region, deniedUntilText

**Key functions:**

- `normalizePublicKey(publicKey)` → uppercase trimmed string
- `validatePublicKey(input)` → normalized key or null (64 hex chars, ≤128 input length)
- `ClusterStateStore.setTrustState(publicKey, stateJson)`: Writes trust state with TTL
- `ClusterStateStore.listPublicBans()`: Returns `PublicBanSummary[]`
- `ClusterStateStore.countActivePublicBans()`: Counts currently enforced `muted` states from an expiry-scored index without scanning dashboard history
- `ClusterStateStore.listDeniedPublishes()`: Returns denied publish events
- `ClusterStateStore.listInstanceObservers()`: Returns observers from all instances
- `ClusterStateStore.getObserverNodeNames(publicKeys[])`: Returns friendly name map
- `ClusterStateStore.claimObserver(publicKey)`: Lua-scripted claim with expiry
- `ClusterStateStore.claimObserverIfAvailable(publicKey)`: Reclaims a missing/self-owned claim without replacing another broker
- `ClusterStateStore.resetNamespace()`: Clears all keys for a namespace

**TTL values:**

- Instance readiness: 90 seconds
- Instance metrics: 150 seconds
- Aedes packet persistence: 24 hours
- Trust state: 90 days of inactivity
- Denied publish events: 24 hours
- Observer claims / node names: configurable (default 24h)

Technologies: ioredis, aedes-persistence-redis, mqemitter-redis

### 3.4. Meshcore.io distributed advert pipeline (`src/meshcore-io-*.ts`)

When `meshcore_io.enabled` is true, every broker offers relevant MQTT `status`, `raw`, and `packets` publications to a bounded, deduplicated Valkey ingress stream. The publication hook runs after Aedes accepts a message, so the broker that actually received the observer traffic can persist it even when another replica currently owns queue production.

One broker at a time owns a token-protected Valkey lease. That producer consumes and reclaims ingress entries, stores only newer valid observer radio settings, parses MeshCore packets, verifies advert signatures, accepts only `REPEATER`, `ROOM`, and `SENSOR` adverts, and atomically adds eligible jobs to the shared upload stream. Queue insertion also enforces cluster-wide capacity, per-node queued/cooldown state, and advert timestamp replay/re-upload rules. Producer and worker loops recreate missing consumer groups after a namespace or stream reset instead of remaining in a `NOGROUP` error loop.

All broker replicas create upload workers in the same Redis Stream consumer group. Workers claim one job at a time, renew the claim while HTTP work is active, sign the Meshcore.io request with an ephemeral Ed25519 key, and acknowledge/delete jobs only after a terminal API response. If a worker or broker disappears, another worker reclaims the pending entry after `worker_claim_timeout_ms`. If the producer disappears, its lease expires and a new producer reclaims pending ingress entries. Shutdown aborts active HTTP requests and makes unfinished claims immediately eligible for takeover.

Dashboard state is read from shared Valkey keys and includes the producer instance/lease, ingress and upload queue counts, aggregate counters, live per-broker worker heartbeats, recent upload/drop history, and the latest integration error. The feature is opt-in and has a disabled runtime that creates no extra Valkey connection.

### 3.5. Dashboard HTTP Server (`src/dashboard.ts`)

A raw Node.js `http.createServer` running in the same process as the MQTT broker. Also serves as the API server for the public observer status endpoint.

**Routes:**

| Method   | Path                                   | Purpose                                                     |
| -------- | -------------------------------------- | ----------------------------------------------------------- |
| GET/HEAD | `/`                                    | HTML shell with embedded CSS and dashboard bootstrap        |
| GET/HEAD | `/api/dashboard`                       | JSON cluster snapshot (brokers, observers, bans, publishes) |
| GET/HEAD | `/api/v1/observers/{publicKey}/status` | Public read-only observer lookup                            |
| GET/HEAD | `/favicon.svg`                         | SVG favicon (cached 24h)                                    |
| GET/HEAD | `/dashboard-client.js`                 | Bundled React SPA                                           |

**Key types:**

- `DashboardState`: In-memory tracking of connected clients/observers
- `DashboardSnapshot`: generatedAt, respondingBroker, summary, brokers, observers, bans
- `DashboardObserver`: label, publicKey, broker, region, active, abuse
- `ObserverStatus`: known / blocked / unknown / invalid / error responses

**Key functions:**

- `lookupObserverStatus(publicKey, clusterStateStore)`: Combines ban + observer data
- `getSnapshot()`: Writes local metrics to Valkey, reads cluster-wide snapshot
- `sendJson(res, value)`: Writes 200 with JSON content-type and no-store cache
- `renderDashboardHtml()`: Generates the HTML shell with embedded CSS
- `createDashboardServer()`: Creates and returns the HTTP server

**CSS:** All styles are embedded in the HTML shell (no external CSS files). The CSS uses custom properties for theming (`--green-800`, `--ink`, `--muted`, `--line`, `--panel`, `--page`, etc.). Responsive breakpoints at 1180px, 800px, 640px, and 430px.

**CORS:** No CORS headers are currently set. The dashboard and API are served from the same origin by default. If cross-origin access is needed, CORS headers must be added explicitly.

### 3.6. Dashboard React SPA (`src/dashboard-client.tsx`)

Browser-side React application bundled with esbuild. Uses hash-based routing (`#overview`, `#brokers`, `#observers`, `#bans`). Fetches data every 5 seconds from `/api/dashboard`. No external state management library — pure React `useState`/`useEffect`/`useMemo`.

**Views:**

- **Overview**: Mätkort (aktiva observatörer, brokerinstanser, publiceringar och nekade händelser), statuspanel för brokerinstanser, fördelningsdiagram, tabell över nekade händelser och publiceringsflöde, "Kontrollera din observatör" lookup panel
- **Brokers**: Broker table with sortable columns, broker modal showing per-broker observers
- **Observers**: Search input + region dropdown filter, sortable observer table, observer modal with messages and abuse state
- **Bans**: Denied publishes + trust-state bans table, ban modal with detail

**Key components:**

- `RegionDisplay` → renders county name + IATA code via `formatRegionDisplay` helper
- `PublishFeed` → 6-column grid on desktop, card layout on mobile
- `ObserverModal` / `BrokerModal` / `BanModal` → detail modals with backdrop
- `ObserverSearch` → search input + region dropdown filter
- `ObserverLookup` → public key lookup form calling `/api/v1/observers/.../status`
- `Pill` → status badge (green/orange/red/gray)
- `Panel`, `MetricCard`, `Empty`, `Icon` → reusable UI primitives

**Data fetching:**

- Main data: `GET /api/dashboard` every 5 seconds → `DashboardSnapshot`
- Lookup: `GET /api/v1/observers/{publicKey}/status` on demand

### 3.7. Dashboard Helpers (`src/dashboard-helpers.ts`)

Shared display logic imported by both `dashboard-client.tsx` and tested independently.

**Key functions:**

- `formatRegionDisplay(region, countyLookup)` → `{ countyName?, code }` or null
- `formatRegionOptionLabel(region, countyLookup)` → "County name (IATA)" or just "IATA"
- `formatDeniedUntilLabel(entry)` → deniedUntilText or formatted mutedUntil or "-"
- `stockholmTime(timestamp)` → compact date-time format (no timezone suffix)

### 3.8. Abuse Detection (`src/abuse-detector.ts`)

Tracks duplicate payloads, packet rate, anomalous packet size/copies, topic churn, and IATA change observations. With enforcement disabled, clients are marked `would_mute` and shown as "Varnas"; traffic is still allowed. With enforcement enabled, clients are muted and publishes are denied until the time-limited denial expires.

**Key types:**

- `ClientTrustState`: status (allowed/muted/would_mute), mutedAt, mutedUntil, muteReason, abuseBlockCount
- `AbuseConfig`: enforcement_enabled, detection thresholds

Compatibility note: Internal trust-state field names (`mutedAt`, `mutedUntil`, `muteReason`, `abuseBlockCount`) are retained for compatibility even though operator text avoids calling shadow-mode clients banned.

### 3.9. Target Broker Forwarding (`src/target-bridge.ts`)

Optional forwarding from the broker to another MQTT broker. It forwards only traffic from publisher clients whose observer public key is currently claimed by that broker instance, preserving original topics and payloads while always sending `retain: false`. Uses the `mqtt` npm package for the outbound connection.

**Key functions:**

- `shouldForwardToTarget(client, packet)`: Decides per-packet forwarding eligibility
- `startTargetBridge(config, deps)`: Creates MQTT client, sets up forward handler

Configuration: `target_mqtt` in `config.yaml`

### 3.10. Docker Healthcheck (`src/healthcheck.ts` + `src/healthcheck-loopback.ts` + `src/docker-health-user.ts`)

On broker startup, the broker creates a runtime-only `docker_health` subscriber user and writes its generated 32-character password to a local credential file (`/tmp/meshcore-mqtt-broker/docker_health_credentials.json`). The healthcheck reads that file, connects over WebSocket, encodes raw MQTT CONNECT/SUBSCRIBE/PUBLISH packets, performs a publish/subscribe loopback on `healthcheck/docker_health`, and verifies the broker's Valkey readiness key. The temporary WebSocket is terminated as soon as the exact loopback payload is received so probes cannot leave lingering connections or timers that consume the health user's connection limit. Both the MQTT loopback and Valkey commands have bounded timeouts; a Valkey TCP connection that accepts traffic but stops answering therefore fails the probe within `healthcheck.valkey_timeout_ms` instead of waiting for the container runtime to kill the healthcheck process.

Security: The generated healthcheck password is runtime state, not config. It must not be stored in `config.yaml`.

### 3.11. CLI (`src/cli.ts`)

Operator CLI tool: `mc-mqtt` (binary in package.json). Connects directly to Valkey (not through the broker MQTT).

**Commands:**

- `status`: Shows this instance and cluster instances
- `observer list`: Lists claimed observers from Valkey
- `abuse list/remove/clearall`: Manages ban/trust state
- `reset`: Clears the entire Valkey namespace (requires confirmation)

### 3.12. Logger (`src/logger.ts`)

Swedish console logger with:

- Log levels: debug, info, warn, error
- Colorized bracket tags: `[INFO]`, `[VARNING]`, `[FEL]`, `[KRITISKT]`
- Stockholm timezone timestamps
- Context-aware logging via `setBrokerLogContext()` (instanceId, namespace)

### 3.13. Swedish Counties (`src/swedish-counties.ts`)

Fetches Swedish county/IATA data from a remote JSON source with local file fallback. Provides lookup methods for region metadata used by the dashboard.

**Key types:**

- `CountyEntry`: countyName, primaryIata, secondaryIatas
- `CountyLookupEntry`: countyName, primaryIata, isPrimary
- `SwedishCountiesLookup`: getAllCountyLookup(), isAvailable(), getPrimaryIataForIata(iata)

### 3.14. Rate Limiter (`src/rate-limiter.ts`)

Simple in-memory IP-based connection rate limiter. Tracks failed connection attempts per IP with configurable failure threshold and block window. Expired entries are pruned lazily and the map is capped at 10,000 addresses so a stream of one-off source IPs cannot grow process memory without bound.

### 3.15. IP Utilities (`src/ip-utils.ts`)

Extracts client IP from incoming HTTP requests, with support for Cloudflare `CF-Connecting-IP` header, `X-Forwarded-For`, and `X-Real-IP` from trusted proxy CIDRs.

### 3.16. Instance ID (`src/instance-id.ts`)

Generates and persists broker instance IDs. Format: `{brokerName}-{4-char code}` (e.g., `ReviewBroker-STO`). IDs are written to a runtime file and reused across restarts if the file exists.

### 3.17. Heartbeat (`src/heartbeat.ts`)

Constants for the broker heartbeat feature: topic `heartbeat/`, message "Hjärtat slår", interval 30 seconds.

### 3.18. Aedes Types (`src/aedes-types.ts`)

TypeScript type extensions for Aedes Client objects, adding `clientType` (publisher/subscriber), `publicKey`, `nodeName`, `username`, `region`, `connectedAt`, and other broker-specific metadata to the standard Aedes Client type.

## 4. Data Stores

### 4.1. Valkey

Type: Redis protocol key-value store

Purpose: Required cluster and runtime state store.

Key state categories: Aedes packets, broker readiness, broker metrics, subscriber connections, observer claims, observer friendly names, status timestamp ordering, abuse trust state, an expiry-scored active-mute index, denied publish events, and short-lived locks. Existing trust states are backfilled once per namespace under a short-lived migration lock; subsequent trust-state writes keep both indexes synchronized.

Retention model: Readiness and metrics are short-lived, Aedes packet persistence expires after 24 hours, abuse trust state expires after 90 days of inactivity, denied publish events expire after 24 hours, and locks expire after a few seconds.

### 4.2. Runtime Files

Type: Local container filesystem

Purpose: Generated broker runtime ID and generated docker healthcheck credentials. These files are runtime state and are intentionally separate from read-only `config.yaml`.

### 4.3. Browser State

Type: React component state + URL hash

Purpose: Dashboard view state (current view, search query, region filter, selected broker/observer/ban) is stored in React state and synchronized to the URL hash for shareable links. Data is fetched from the server API and not persisted in the browser.

## 5. APIs

### 5.1. Internal Dashboard API

`GET /api/dashboard` — Returns a full cluster snapshot JSON. Called by the React SPA every 5 seconds. Reads from Valkey via `ClusterStateStore`. Response type: `DashboardSnapshot`.

### 5.2. Public Observer Status API

`GET /api/v1/observers/{publicKey}/status` — Public read-only endpoint. No API key required. Returns JSON with status `known`, `blocked`, `unknown`, `invalid`, or `error`. Used by the "Kontrollera din observatör" dashboard panel and by external projects.

**Response format:** See `README.md` for full documentation with examples.

**Lookup logic (server-side):**

1. If public key exists in blocked/denied-state → status `blocked` (always wins over known)
2. Else if public key exists in observer list → status `known`
3. Else → status `unknown`
4. Invalid input → HTTP 400, status `invalid`

**Implementation:** `lookupObserverStatus()` in `src/dashboard.ts`, using `ClusterStateStore.listPublicBans()`, `.listDeniedPublishes()`, `.listInstanceObservers()`, and `.getObserverNodeNames()`.

**Public key validation:** `validatePublicKey()` in `src/orchestration.ts` — trims, normalizes to uppercase, validates 64-character hex format, rejects >128 character input.

### 5.3. MeshCore JWT Verification

`@michaelhart/meshcore-decoder` verifies publisher authentication tokens. Used only in `src/server.ts`.

### 5.4. Target MQTT Broker

Optional outbound MQTT connection configured under `target_mqtt` in `config.yaml`.

## 6. Deployment & Infrastructure

Container images: `bjorkan/meshcore-mqtt-broker`, `ghcr.io/bjorkan/meshcore-mqtt-broker`.

Required service: Valkey reachable via `broker.kv_url`.

Configuration: Mount `config.yaml` read-only. In Swarm, prefer:

```yaml
configs:
  broker_config:
    file: ./config.yaml
```

Subscriber credentials: Keep subscriber login entries in `config.yaml` under `subscribers.users`.

CI/CD: GitHub Actions build and publish broker images. Renovate handles dependency update PRs. Additional workflows: dashboard screenshots (Playwright), autofix (Prettier/ESLint).

## 7. Security Considerations

Authentication: Publishers use MeshCore JWTs signed for the public key in `username = v1_{PUBLIC_KEY}`. Subscriber accounts use configured username/password lines.

Authorization: Publishers can publish only under `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` except broker-owned or reserved paths. Non-admin subscribers are intentionally restricted at subscribe time and filtered again at forward time for `/internal`, `$SYS/*`, and `/serial/*`.

Sensitive data: `/internal` topics contain JWT payload and trust telemetry and are admin-only. Dashboard snapshots must not expose private keys, passwords, client IPs, raw packet payloads, internal topics, or serial command/response topics. The public observer status API must not return internal tokens, JWT, secrets, Valkey keys, or stacktraces.

Config safety: `config.yaml` is read-only runtime configuration. The broker may write runtime ID and healthcheck credential files, but it must not write back to config files.

Input validation: The public API validates public key format, trims input, and limits length before any Valkey lookup. Invalid input returns HTTP 400 without stacktraces.

## 8. Development & Testing Environment

Local setup:

```bash
npm install
npm test
```

Testing framework: Jest with Node ESM (`.mjs` test files). Tests import from `dist/` (compiled TypeScript). Valkey is required for integration tests — use `docker run -d -p 6379:6379 valkey/valkey:9-alpine`.

Test commands:

- `npm test` — Full suite (requires Valkey on localhost:6379)
- `npm run test:ci` — CI-optimized test run
- `npm run build` — TypeScript compile + esbuild dashboard-client bundle

Important test areas: config loading, MQTT runtime authorization, retained publish stripping, allowed regions, abuse detector behavior, dashboard state, target bridge filtering, healthcheck options, CLI Valkey operations, observer API lookup logic with key validation, and UI source regression.

## 9. Future Considerations / Roadmap

- Surface `allowed_regions.*.friendly_name` in operator-facing dashboard views if region names become useful there.
- Consider renaming internal API fields such as `bans` only with a documented compatibility migration, because dashboard clients and tests currently consume that shape.
- Keep reviewing upstream before changing publisher topic or payload acceptance.

## 10. Project Identification

Project Name: MeshCore MQTT Broker Fork

Repository URL: <https://github.com/Bjorkan/meshcore-mqtt-broker>

Upstream URL: <https://github.com/michaelhart/meshcore-mqtt-broker>

Date of Last Update: 2026-07-09

## 11. Glossary / Acronyms

IATA: Three-letter region/location code used in MeshCore MQTT topics (e.g., STO, GOT, JKG, MMX).

Observer: MeshCore node/client that publishes MQTT messages using its public key identity.

Valkey: Redis-compatible key-value store used for broker cluster and runtime state.

Shadow mode: Abuse enforcement disabled; the broker records that a client would have been denied, but still allows traffic. Operator UI labels this as "Varnas".

Nekad: Operator-facing term for a denied publish event or enforced abuse denial.

Public key: 64-character uppercase hex string identifying a MeshCore node. Normalized via `normalizePublicKey()` → trimmed uppercase. Validated via `validatePublicKey()` → 64-char hex match, ≤128 chars input.

ClusterStateStore: The main Valkey state manager class in `src/orchestration.ts` (`ClusterStateStore`). Handles all Valkey reads and writes.
