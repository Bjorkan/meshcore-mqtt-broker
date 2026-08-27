# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Preserve the upstream MQTT observer contract unless an intentional fork decision below says otherwise.

## Architecture contract

The supported installation is one Docker Compose broker container, one long-lived Bun broker process, one Aedes broker, and the locally deployed MeshDB PostgreSQL cluster. Healthchecks and CLI commands may use short-lived auxiliary processes. Do not add cloud state dependencies, coordination services, broker replicas, election, leases, distributed workers, Docker Swarm mode, or horizontal-scaling abstractions.

Production storage is the pre-provisioned `meshcore` database in the local MeshDB PostgreSQL cluster. Runtime connection settings use `DATABASE_*` environment variables with `DATABASE_PASSWORD_FILE`; do not place database credentials in YAML, command-line arguments, image layers, or source control. Tests use only an explicit isolated PostgreSQL test database.

MeshCore owns `meshcore_private` and `meshcore_public` schemas. Keep raw MQTT and broker operational state private. The public schema is a direct-reader contract and may contain only approved normalized public network data. Meshtastic belongs in a separate database and has no cross-database coupling.

Broker availability takes priority over preserving incompatible historical database state. Bootstrap provisions the exact static current schema as `meshcore_owner`. Startup validates it, attempts a known migration chain once within `DATABASE_MIGRATION_TIMEOUT_MS`, and resets a reachable unsupported, corrupt, or un-migratable `meshcore` database to the canonical schema. Connectivity, authentication, permission, disk, and other infrastructure failures never trigger reset. A process performs at most one automatic reset during startup; failed fresh validation is fatal.

`database_created_at` is persisted UTC metadata for the current database generation. Full recreation replaces it; normal restarts and successful in-place migrations preserve it once present. Human-readable age is derived at response time and never stored. Ordinary performance indexes are excluded from the semantic fingerprint. The broker uses Bun.SQL as its PostgreSQL driver. Keep SQL access behind ApplicationDatabase/ApplicationTransaction. Use Bun.SQL public APIs only; parameterized first-party SQL strings may be executed through the centralized database adapter, and runtime input must never be interpolated into SQL text. Driver changes require the full PostgreSQL, persistence, recovery, and concurrency suites.

## Repository delivery

This repository is `Bjorkan/meshcore-mqtt-broker`, an independent repository with its own history, CI, and releases. It is not part of, a submodule of, or a package dependency of the separate `Bjorkan/meshat-api` repository, but it remains the canonical schema authority that meshat-api depends on at runtime through PostgreSQL.

When an approved coding task modifies tracked files:

1. run the full relevant Bun/PostgreSQL checks,
2. commit the change,
3. push it to `origin/main` over SSH,
4. never force-push or rewrite `main` merely to deliver agent work.

If the repository is unchanged, do not create an empty commit or push.

When schema/public-contract behavior changes, verify compatibility with the separate `Bjorkan/meshat-api` repository (run its REST integration suite against this tree) before delivery.

## Documentation index

| Area                             | File                                |
| -------------------------------- | ----------------------------------- |
| Architecture, schema, deployment | `ARCHITECTURE.md`                   |
| YAML configuration               | `CONFIGURATION.md`                  |
| Contribution workflow            | `CONTRIBUTING.md`                   |
| Source license                   | `LICENSE.md`                        |
| Deployment/API transition notes  | `MIGRATION.md`                      |
| Product scope and principles     | `PRODUCT.md`                        |
| User installation and operations | `README.md`                         |
| Security reporting/deployment    | `SECURITY.md`                       |
| Third-party attribution          | `THIRD_PARTY_NOTICES.md`            |
| MQTT runtime                     | `src/server.ts`                     |
| Database and schema              | `src/database.ts`                   |
| Aedes persistence                | `src/aedes-persistence-postgres.ts` |
| Durable/local state              | `src/state-store.ts`                |
| MeshCore.io queue                | `src/meshcore-io-runtime.ts`        |
| Verified node advert ingestion   | `src/node-adverts.ts`               |
| Sweden geofence                  | `src/sweden-geofence.ts`            |
| IATA ingress registry            | `src/iata-registry.ts`              |
| MeshCore region scope registry   | `src/region-scopes.ts`              |
| Shared HTTP listener             | `src/web-server.ts`                 |

## Compatibility decisions

1. General client retain flags are intentionally removed. `/neighbors` is the only retained exception and expires after 48 hours in MQTT.
2. Authenticated publishers may publish under `meshcore/{IATA}/{OWN_PUBLIC_KEY}/{subtopic}` when the key matches, the uppercase three-letter IATA is allowed, and the path is not broker-owned/reserved. Non-IATA `test` ingress requires an explicit compatibility opt-in and is never normalized into history.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not required. Documented non-JSON extensions such as serial response flow remain explicit.
4. Non-admin subscribers remain restricted at subscribe time, with forward-time filtering for private broker data.
5. Swedish CLI, database, and selected runtime log text remains fork-local. Configuration errors and configured secondary-IATA correction text are neutral English. Canonical `allowed_iata`, the legacy `allowed_regions` IATA-only alias, read-only YAML configuration, integrated target forwarding, and MeshCore.io opt-in remain fork features.
6. Invalid/unlisted IATA publishes are denied events, not abuse mutes by themselves.

Treat publisher authentication, topic/payload acceptance, subscriber roles, `/internal`, `$SYS/*`, `/serial/*`, abuse monitoring/enforcement, target forwarding, and retained-neighbor behavior as compatibility-sensitive. Compare upstream before changing those behaviors and add tests for intentional differences.

## State rules

Durable state belongs in relational tables reflecting the real model, with bound parameters, deterministic ordering, indexes, explicit transactions, bounded queries, and bounded cleanup. Do not recreate a generic Redis/key-value abstraction. Active sockets, observer ownership, subscriber sessions, and rolling metrics are process-local and must not be persisted.

The Aedes adapter must implement the complete operation set actually used by Aedes, not only enough methods to compile. Retained packets, persistent subscriptions, offline queues, QoS state, and wills must recover after restart.

Keep `ARCHITECTURE.md` current for schema, deployment, security, lifecycle, or data-flow changes. Keep `README.md` current for installation, configuration, API, CLI, backup, and compatibility changes. Update `OPENAPI_DOCUMENT`, `API_DEVELOPMENT.md`, `CONFIGURATION.md`, `MIGRATION.md`, `PRODUCT.md`, `DESIGN.md`, `SECURITY.md`, and `THIRD_PARTY_NOTICES.md` whenever their respective contracts or claims change.
