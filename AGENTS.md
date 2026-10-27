# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Preserve the upstream MQTT observer contract unless an intentional fork decision below says otherwise.

## Architecture contract

The supported installation is one Docker Compose broker container, one long-lived Rust broker process, and one embedded RMQTT broker, behind Traefik/CrowdSec for TLS and IP blocking. The broker is stateless: MQTT sessions, retained packets, offline queues, QoS state, wills, observer state, and the MeshCore.io/target forwarding queues live in process memory and reset on restart. There is no database. Healthchecks may use short-lived auxiliary processes. Do not add cloud state dependencies, coordination services, broker replicas, election, leases, distributed workers, Docker Swarm mode, horizontal-scaling abstractions, or a database.

The broker has no abuse detector, administrative CLI, or cross-connection node-name cache. MQTT admission still enforces authentication, IATA/topic/payload rules, subscriber roles, and connection limits. IP blocking lives in Traefik/CrowdSec. Only active settings have typed configuration loaders. Removed `storage`, `decryption`, `proxy`, `broker.runtime_id_file`, `abuse`, and `broker.node_name_cache_ttl_ms` settings are treated as unknown YAML keys; do not restore compatibility-only parsers or no-op CLI commands. `GET /status` returns `{ status: "ok", storage: "stateless", instanceId, uptimeMs, observers, target, meshcoreIo }`; `instanceId` is one per process and rotates on restart. Docker HEALTHCHECK is `GET /status` (no creds). Auth `AUTH_*` codes are CONNACK-5 + log-only (MQTT 3.1.1 has no reason string); publish codes arrive on the observer `/error` topic.

Every connection or publish denial carries a stable machine-readable observer error code (`ObserverErrorCode` in `src/error.rs`). Auth denials surface as MQTT 3.1.1 CONNACK returnCode 5; publish denials surface as the RMQTT ACL reason plus JSON on the observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic. The broker never accepts publishes to `/error`; observers subscribe to receive codes.

The broker always runs alone. Observer ownership is a single in-process map: a newer authenticated connection for the same public key replaces the older one. Subscriber connection limits are counted in process memory.

## Repository delivery

This repository is `Bjorkan/meshcore-mqtt-broker`, an independent repository with its own history, CI, and releases. It is not part of, a submodule of, or a package dependency of the separate `Bjorkan/meshat-api` repository.

When an approved coding task modifies tracked files:

1. run `cargo fmt --all -- --check`, `cargo check --all-targets`, `cargo test --all-targets`, and `cargo clippy --all-targets -- -D warnings`,
2. commit the change,
3. push it to `origin/main` over SSH,
4. never force-push or rewrite `main` merely to deliver agent work.

If the repository is unchanged, do not create an empty commit or push.

## Documentation index

| Area                             | File                     |
| -------------------------------- | ------------------------ |
| Rust migration status            | `RUST.md`                |
| User installation and operations | `README.md`              |
| Source license                   | `LICENSE.md`             |
| Security reporting/deployment    | `SECURITY.md`            |
| Third-party attribution          | `THIRD_PARTY_NOTICES.md` |
| RMQTT hook integration           | `src/rmqtt_handler.rs`   |
| Authentication                   | `src/auth.rs`            |
| MQTT ACL policy                  | `src/acl.rs`             |
| Error codes and notifications    | `src/error.rs`           |
| Typed YAML configuration         | `src/config.rs`          |

## Compatibility decisions

1. Every accepted exact `/neighbors` publish is always retained regardless of the client's retain flag, including opted-in `test` ingress, locally and on the target. All other client publishes are nonretained. Neighbor expiry is scheduled for 48 hours. At capacity, clear the oldest retained value before reusing its tracking slot; never silently discard its expiry obligation.
2. Authenticated publishers may publish under `meshcore/{IATA}/{OWN_PUBLIC_KEY}/{subtopic}` when the key matches, the uppercase three-letter IATA is allowed, and the path is not broker-owned/reserved. `error` is broker-owned: observers subscribe to their own `/error` topic for denial codes and must not publish to it. Non-IATA `test` ingress requires an explicit compatibility opt-in.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not required. Documented non-JSON extensions such as serial response flow remain explicit.
4. Non-admin subscribers remain restricted at subscribe time, with forward-time filtering for private broker data.
5. Selected Swedish runtime log text remains fork-local. Configuration errors and configured secondary-IATA correction text are neutral English. Canonical `allowed_iata`, the legacy `allowed_regions` IATA-only alias, read-only YAML configuration, integrated target forwarding, and MeshCore.io opt-in remain fork features.
6. Invalid/unlisted IATA publishes are denied with `PUBLISH_*` codes. There is no abuse scoring, muting, or broker-owned IP blocking.

Treat publisher authentication, topic/payload acceptance, observer error codes, subscriber roles, `/internal`, `/error`, `$SYS/*`, `/serial/*`, target forwarding, and retained-neighbor behavior as compatibility-sensitive. Compare upstream before changing those behaviors and add tests for intentional differences.

## State rules

The broker is stateless by design. Active sockets, observer ownership, subscriber sessions, retained packets, queues, wills, and MeshCore.io/target state are process-local and must not be persisted. Do not reintroduce a database, a generic Redis/key-value abstraction, or file-backed durability.

Keep `RUST.md` current throughout the migration. Keep `README.md` current for installation, configuration, API, and compatibility changes. Update `SECURITY.md` and `THIRD_PARTY_NOTICES.md` whenever their respective contracts or claims change.
