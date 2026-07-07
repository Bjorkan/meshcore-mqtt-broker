# Architecture Overview

This is the living architecture document for the MeshCore MQTT broker fork. Update it whenever configuration, deployment, MQTT behavior, Valkey state, dashboard data, healthchecks, abuse handling, or bridge behavior changes.

## 1. Project Structure

```text
[Project Root]/
├── broker/                    # Main MQTT broker image and runtime
│   ├── src/
│   │   ├── server.ts          # Aedes/WebSocket MQTT runtime and authorization
│   │   ├── config.ts          # Read-only config.yaml loader with env overrides
│   │   ├── orchestration.ts   # Valkey-backed cluster, claims, metrics, trust state
│   │   ├── dashboard.ts       # Dashboard HTTP API and HTML shell
│   │   ├── dashboard-client.tsx # Browser UI for broker/observer/denied views
│   │   ├── abuse-detector.ts  # Rate, duplicate, anomaly, and shadow/enforcement logic
│   │   ├── target-bridge.ts   # Broker-integrated forwarding to another MQTT broker
│   │   ├── healthcheck.ts     # MQTT loopback and Valkey readiness healthcheck
│   │   └── docker-health-user.ts # Runtime-created healthcheck user credential file
│   ├── tests/                 # Jest unit/integration tests for broker contracts
│   ├── config.yaml            # Read-only runtime configuration defaults/example
│   └── Dockerfile
├── bridge/                    # Legacy standalone bridge image
├── compose.yaml.example       # Local compose example with read-only config mount
├── AGENTS.md                  # Agent compatibility and documentation rules
└── README.md                  # Repository-level image overview
```

## 2. High-Level System Diagram

```text
[MeshCore observer]
  │ MQTT over WebSocket, JWT publisher auth
  ▼
[broker/src/server.ts: Aedes broker]
  ├── reads read-only config.yaml through config.ts
  ├── authenticates publishers and subscriber accounts
  ├── validates topic, region, public key, payload, retain behavior
  ├── records abuse/trust state and denied events in Valkey
  ├── publishes public MQTT traffic to local/cluster subscribers
  ├── publishes broker-owned /internal telemetry for admins
  └── optionally forwards claimed observer traffic to target MQTT

[Valkey]
  ├── Aedes persistence and mq emitter
  ├── broker readiness and metrics
  ├── subscriber connection limits
  ├── observer ownership claims
  ├── observer friendly names
  ├── abuse trust state
  └── short-lived denied publish events

[Dashboard HTTP server]
  └── builds a public cluster snapshot from Valkey for operators

[Docker healthcheck]
  └── authenticates as runtime docker_health user and verifies MQTT loopback plus Valkey readiness
```

## 3. Core Components

### 3.1. MQTT Broker Runtime

Name: Broker service

Description: The primary service accepts MQTT over WebSocket, authenticates MeshCore publishers with `v1_{PUBLIC_KEY}` and MeshCore JWT passwords, authenticates read-only subscriber accounts from `config.yaml`, enforces publish/subscribe authorization, strips retained client publishes, and exposes a dashboard. It is intentionally close to upstream MQTT behavior for publisher topics and normal JSON payloads.

Technologies: Node.js, TypeScript, Aedes, ws, @michaelhart/meshcore-decoder

Deployment: Docker image from `broker/Dockerfile`, normally backed by Valkey. Docker Swarm can mount `broker/config.yaml` as `/run/configs/meshcore-mqtt-broker-config.yaml`.

### 3.2. Configuration Loader

Name: `broker/src/config.ts`

Description: Loads all runtime settings from read-only YAML. The broker never writes to `config.yaml`. There is no `.env` compatibility layer; subscriber credentials are structured entries under `subscribers.users`.

Key decision: `allowed_regions` is a YAML mapping keyed by IATA code:

```yaml
allowed_regions:
  JKG:
    friendly_name: Jönköping och södra Vätternområdet
```

Only the key controls publish authorization today; metadata such as `friendly_name` is available for future operator-facing use.

### 3.3. Orchestration and Valkey

Name: Cluster state store

Description: Valkey is required even for one broker replica. It provides Aedes cluster routing/persistence, subscriber connection limits, readiness, metrics, observer claims, friendly names, trust state, and denied publish event storage. Broker instance IDs are generated at startup and written to a local runtime file so dashboard, healthcheck, CLI, and target forwarding agree on identity.

Technologies: ioredis, aedes-persistence-redis, mqemitter-redis

### 3.4. Dashboard

Name: Operator dashboard

Description: The dashboard API builds a cluster snapshot from Valkey after writing the responding broker's current metrics. It shows brokers, active claimed observers, recent public publishes, abuse trust state, and short-lived denied publish events. Operator language uses "Nekad" for denied/enforced events and "Varnas" for abuse shadow mode when enforcement is disabled.

Technologies: Node HTTP server, React client bundled with esbuild

### 3.5. Abuse Detection

Name: Abuse detector

Description: Tracks duplicate payloads, packet rate, anomalous packet size/copies, topic churn, and IATA change observations. With enforcement disabled, clients are marked `would_mute` and shown as "Varnas"; traffic is still allowed. With enforcement enabled, clients are muted and publishes are denied until the time-limited denial expires.

Compatibility note: Internal trust-state field names such as `mutedAt`, `mutedUntil`, `muteReason`, and `abuseBlockCount` are retained for compatibility even though operator text avoids calling shadow-mode clients banned.

### 3.6. Target Broker Forwarding

Name: Integrated target bridge

Description: Optional forwarding from the broker to another MQTT broker. It forwards only traffic from publisher clients whose observer public key is currently claimed by that broker instance, preserving original topics and payloads while always sending `retain: false`.

Configuration: `target_mqtt` in `config.yaml`

### 3.7. Docker Healthcheck

Name: MQTT loopback and Valkey readiness healthcheck

Description: On broker startup, the broker creates a runtime-only `docker_health` subscriber user and writes its generated password to a local credential file. The healthcheck reads that file, connects over WebSocket, performs an MQTT publish/subscribe loopback, and verifies the broker's Valkey readiness key.

Security decision: The generated healthcheck password is runtime state, not config. It must not be stored in `config.yaml`.

### 3.8. Legacy Standalone Bridge

Name: `bridge/`

Description: Older standalone bridge image retained for compatibility. New target-broker forwarding should normally use `broker/src/target-bridge.ts`.

## 4. Data Stores

### 4.1. Valkey

Type: Redis protocol key-value store

Purpose: Required cluster and runtime state store.

Key state categories: Aedes packets, broker readiness, broker metrics, subscriber connections, observer claims, observer friendly names, status timestamp ordering, abuse trust state, denied publish events, and short-lived locks.

Retention model: Readiness and metrics are short-lived, Aedes packet persistence expires after 24 hours, abuse trust state expires after 90 days of inactivity, denied publish events expire after 24 hours, and locks expire after a few seconds.

### 4.2. Runtime Files

Type: Local container filesystem

Purpose: Generated broker runtime ID and generated docker healthcheck credentials. These files are runtime state and are intentionally separate from read-only `config.yaml`.

## 5. External Integrations / APIs

MeshCore JWT verification: `@michaelhart/meshcore-decoder` verifies publisher authentication tokens.

Target MQTT broker: Optional outbound MQTT connection configured under `target_mqtt`.

Docker/Swarm health management: Uses Docker `HEALTHCHECK` and optionally Swarm configs for read-only runtime configuration.

## 6. Deployment & Infrastructure

Container images: `bjorkan/meshcore-mqtt-broker`, `ghcr.io/bjorkan/meshcore-mqtt-broker`, and legacy bridge images.

Required service: Valkey reachable via `broker.kv_url`.

Configuration: Mount `broker/config.yaml` read-only. In Swarm, prefer:

```yaml
configs:
  broker_config:
    file: ./broker/config.yaml
```

Subscriber credentials: Keep subscriber login entries in `config.yaml` under `subscribers.users`.

CI/CD: GitHub Actions build and publish broker and bridge images separately. Renovate handles dependency update PRs.

## 7. Security Considerations

Authentication: Publishers use MeshCore JWTs signed for the public key in `username = v1_{PUBLIC_KEY}`. Subscriber accounts use configured username/password lines.

Authorization: Publishers can publish only under `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` except broker-owned or reserved paths. Non-admin subscribers are intentionally restricted at subscribe time and filtered again at forward time for `/internal`, `$SYS/*`, and `/serial/*`.

Sensitive data: `/internal` topics contain JWT payload and trust telemetry and are admin-only. Dashboard snapshots must not expose private keys, passwords, client IPs, raw packet payloads, internal topics, or serial command/response topics.

Config safety: `config.yaml` is read-only runtime configuration. The broker may write runtime ID and healthcheck credential files, but it must not write back to config files.

## 8. Development & Testing Environment

Local setup:

```bash
cd broker
npm install
npm test
```

Testing framework: Jest with TypeScript build step.

Important test areas: config loading, MQTT runtime authorization, retained publish stripping, allowed regions, abuse detector behavior, dashboard state, target bridge filtering, healthcheck options, and CLI Valkey operations.

## 9. Future Considerations / Roadmap

- Surface `allowed_regions.*.friendly_name` in operator-facing dashboard views if region names become useful there.
- Consider renaming internal API fields such as `bans` only with a documented compatibility migration, because dashboard clients and tests currently consume that shape.
- Keep reviewing upstream before changing publisher topic or payload acceptance.

## 10. Project Identification

Project Name: MeshCore MQTT Broker Fork

Repository URL: <https://github.com/Bjorkan/meshcore-mqtt-broker>

Upstream URL: <https://github.com/michaelhart/meshcore-mqtt-broker>

Date of Last Update: 2026-07-07

## 11. Glossary / Acronyms

IATA: Three-letter region/location code used in MeshCore MQTT topics.

Observer: MeshCore node/client that publishes MQTT messages using its public key identity.

Valkey: Redis-compatible store used for broker cluster and runtime state.

Shadow mode: Abuse enforcement disabled; the broker records that a client would have been denied, but still allows traffic. Operator UI labels this as "Varnas".

Nekad: Operator-facing term for a denied publish event or enforced abuse denial.
