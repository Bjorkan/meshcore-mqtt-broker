# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Preserve the upstream MQTT observer contract unless an intentional fork decision below says otherwise.

## Architecture contract

The supported installation is one Docker Compose broker container, one long-lived Node.js broker process, one Aedes broker, and the locally deployed MeshDB PostgreSQL cluster. Healthchecks and CLI commands may use short-lived auxiliary processes. Do not add cloud state dependencies, coordination services, broker replicas, election, leases, distributed workers, Docker Swarm mode, or horizontal-scaling abstractions.

Production storage is the pre-provisioned `meshcore` database in the local MeshDB PostgreSQL cluster. Runtime connection settings use `DATABASE_*` environment variables with `DATABASE_PASSWORD_FILE`; do not place database credentials in YAML, command-line arguments, image layers, or source control. Tests use only an explicit isolated PostgreSQL test database.

MeshCore owns `meshcore_private` and `meshcore_public` schemas. Keep raw MQTT and broker operational state private. The public schema is a direct-reader contract and may contain only approved normalized public network data. Meshtastic belongs in a separate database and has no cross-database coupling.

This is a clean-install schema. There is no legacy or test-ingestor import. Bootstrap provisions the exact static current schema as `meshcore_owner`; the runtime validates it and, when it detects MeshCore schema drift, may drop and recreate the non-critical `meshcore` database and its schemas so the broker can repopulate them. This automatic reset applies only to MeshCore data and never to Meshtastic or other databases.

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
| Shared HTTP listener             | `src/web-server.ts`                 |

## Compatibility decisions

1. General client retain flags are intentionally removed. `/neighbors` is the only retained exception and expires after 48 hours in MQTT.
2. Authenticated publishers may publish under `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` when the key matches and the path is not broker-owned/reserved.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not required. Documented non-JSON extensions such as serial response flow remain explicit.
4. Non-admin subscribers remain restricted at subscribe time, with forward-time filtering for private broker data.
5. Swedish CLI, database, and selected runtime log text remains fork-local. Configuration errors and configured secondary-region correction text are neutral English. `allowed_regions`, read-only YAML configuration, integrated target forwarding, and MeshCore.io opt-in remain fork features.
6. Invalid/unlisted IATA publishes are denied events, not abuse mutes by themselves.

Treat publisher authentication, topic/payload acceptance, subscriber roles, `/internal`, `$SYS/*`, `/serial/*`, abuse monitoring/enforcement, target forwarding, and retained-neighbor behavior as compatibility-sensitive. Compare upstream before changing those behaviors and add tests for intentional differences.

## State rules

Durable state belongs in relational tables reflecting the real model, with bound parameters, deterministic ordering, indexes, explicit transactions, bounded queries, and bounded cleanup. Do not recreate a generic Redis/key-value abstraction. Active sockets, observer ownership, subscriber sessions, and rolling metrics are process-local and must not be persisted.

The Aedes adapter must implement the complete operation set actually used by Aedes, not only enough methods to compile. Retained packets, persistent subscriptions, offline queues, QoS state, and wills must recover after restart.

Keep `ARCHITECTURE.md` current for schema, deployment, security, lifecycle, or data-flow changes. Keep `README.md` current for installation, configuration, API, CLI, backup, and compatibility changes. Update `OPENAPI_DOCUMENT`, `API_DEVELOPMENT.md`, `CONFIGURATION.md`, `MIGRATION.md`, `PRODUCT.md`, `DESIGN.md`, `SECURITY.md`, and `THIRD_PARTY_NOTICES.md` whenever their respective contracts or claims change.
