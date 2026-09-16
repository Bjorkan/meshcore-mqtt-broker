# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Preserve the upstream MQTT observer contract unless an intentional fork decision below says otherwise.

## Architecture contract

The supported installation is one Docker Compose broker container, one long-lived Bun broker process, and one Aedes broker, behind Traefik/CrowdSec for TLS and IP blocking. The broker is stateless: MQTT sessions, retained packets, offline queues, QoS state, wills, observer state, abuse observations, and the MeshCore.io/target forwarding queues live in process memory and reset on restart. There is no database. Healthchecks and CLI commands may use short-lived auxiliary processes. Do not add cloud state dependencies, coordination services, broker replicas, election, leases, distributed workers, Docker Swarm mode, horizontal-scaling abstractions, or a database.

Abuse detection is observe-only logging; nothing is muted, silenced, or IP-blocked by the broker. `abuse.enforcement_enabled` is parsed for YAML compatibility but ignored. The `storage`, `decryption`, and `proxy` YAML sections are parsed for compatibility but ignored. `GET /status` returns `{ status: "ok", storage: "stateless", instanceId, uptimeMs, observers, target, meshcoreIo }`; `instanceId` is one per process and rotates on restart. Docker HEALTHCHECK is `GET /status` (no creds). Auth `AUTH_*` codes are CONNACK-5 + log-only (MQTT 3.1.1 has no reason string); publish codes arrive on the observer `/error` topic.

Every connection or publish denial carries a stable machine-readable observer error code (`OBSERVER_ERROR_CODES` in `src/server.ts`, documented in `CONFIGURATION.md`). Auth denials surface as MQTT 3.1.1 CONNACK returnCode 5 with `[CODE] detail`; publish denials surface as the authorizePublish error plus JSON on the observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic. The broker never accepts publishes to `/error`; observers must subscribe to receive codes.

The broker always runs alone. Observer ownership is a single in-process map: a newer authenticated connection for the same public key replaces the older one. Subscriber connection limits are counted in process memory.

## Repository delivery

This repository is `Bjorkan/meshcore-mqtt-broker`, an independent repository with its own history, CI, and releases. It is not part of, a submodule of, or a package dependency of the separate `Bjorkan/meshat-api` repository.

When an approved coding task modifies tracked files:

1. run `bun run check` and `bun test`,
2. commit the change,
3. push it to `origin/main` over SSH,
4. never force-push or rewrite `main` merely to deliver agent work.

If the repository is unchanged, do not create an empty commit or push.

## Documentation index

| Area                             | File                         |
| -------------------------------- | ---------------------------- |
| Architecture, stateless runtime  | `ARCHITECTURE.md`            |
| YAML configuration, error codes  | `CONFIGURATION.md`           |
| Contribution workflow            | `CONTRIBUTING.md`            |
| Source license                   | `LICENSE.md`                 |
| Deployment/stateless notes       | `MIGRATION.md`               |
| Product scope and principles     | `PRODUCT.md`                 |
| User installation and operations | `README.md`                  |
| Security reporting/deployment    | `SECURITY.md`                |
| Third-party attribution          | `THIRD_PARTY_NOTICES.md`     |
| MQTT runtime, error codes        | `src/server.ts`              |
| Observe-only abuse detection     | `src/abuse-detector.ts`      |
| In-memory MeshCore.io queue      | `src/meshcore-io-runtime.ts` |
| In-memory target forwarding      | `src/target-bridge.ts`       |
| IATA ingress registry            | `src/iata-registry.ts`       |
| MeshCore region scope registry   | `src/region-scopes.ts`       |

## Compatibility decisions

1. General client retain flags are intentionally removed. `/neighbors` is the only retained exception and expires after 48 hours in MQTT.
2. Authenticated publishers may publish under `meshcore/{IATA}/{OWN_PUBLIC_KEY}/{subtopic}` when the key matches, the uppercase three-letter IATA is allowed, and the path is not broker-owned/reserved. `error` is broker-owned: observers subscribe to their own `/error` topic for denial codes and must not publish to it. Non-IATA `test` ingress requires an explicit compatibility opt-in.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not required. Documented non-JSON extensions such as serial response flow remain explicit.
4. Non-admin subscribers remain restricted at subscribe time, with forward-time filtering for private broker data.
5. Swedish CLI and selected runtime log text remains fork-local. Configuration errors and configured secondary-IATA correction text are neutral English. Canonical `allowed_iata`, the legacy `allowed_regions` IATA-only alias, read-only YAML configuration, integrated target forwarding, and MeshCore.io opt-in remain fork features.
6. Invalid/unlisted IATA publishes are denied with `PUBLISH_*` codes, not abuse mutes. Abuse detection never denies or mutes by itself.

Treat publisher authentication, topic/payload acceptance, observer error codes, subscriber roles, `/internal`, `/error`, `$SYS/*`, `/serial/*`, abuse observation, target forwarding, and retained-neighbor behavior as compatibility-sensitive. Compare upstream before changing those behaviors and add tests for intentional differences.

## State rules

The broker is stateless by design. Active sockets, observer ownership, subscriber sessions, rolling abuse observations, retained packets, queues, wills, and MeshCore.io/target state are process-local and must not be persisted. Do not reintroduce a database, a generic Redis/key-value abstraction, or file-backed durability.

Keep `ARCHITECTURE.md` current for deployment, lifecycle, or data-flow changes. Keep `README.md` current for installation, configuration, API, CLI, and compatibility changes. Update `CONFIGURATION.md`, `MIGRATION.md`, `PRODUCT.md`, `SECURITY.md`, and `THIRD_PARTY_NOTICES.md` whenever their respective contracts or claims change.
