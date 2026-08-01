# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Preserve the upstream MQTT observer contract unless an intentional fork decision below says otherwise.

## Architecture contract

The supported installation is one Docker container, one long-lived Node.js broker process, one Aedes broker, and one embedded file-backed Turso database. Healthchecks and CLI commands may use short-lived auxiliary processes. Do not add a required external/cloud state dependency, external database, coordination service, broker replica, election, lease, distributed worker, Docker Swarm mode, or horizontal-scaling abstraction.

Production storage is fixed in `src/database.ts`:

```text
/data/meshcore-mqtt-broker/
/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db
```

Do not expose this through configuration, environment variables, Docker settings, or CLI options. Tests may use only the explicit test database factory/dependency.

This is a clean-install schema. There is no import from old installations and no schema migration system. Do not add database schema migration files, runners, versions, rollback logic, old-schema compatibility, or ORM synchronization. Keep the direct idempotent current-schema initializer. Incompatible databases must fail with clean-directory instructions.

## Documentation index

| Area                             | File                             |
| -------------------------------- | -------------------------------- |
| API development                  | `API_DEVELOPMENT.md`             |
| Architecture, schema, deployment | `ARCHITECTURE.md`                |
| User installation and API        | `README.md`                      |
| YAML configuration               | `CONFIGURATION.md`               |
| Deployment/API transition notes  | `MIGRATION.md`                   |
| Security reporting/deployment    | `SECURITY.md`                    |
| Contribution workflow            | `CONTRIBUTING.md`                |
| Third-party attribution          | `THIRD_PARTY_NOTICES.md`         |
| MQTT runtime                     | `src/server.ts`                  |
| Database and schema              | `src/database.ts`                |
| Aedes persistence                | `src/aedes-persistence-turso.ts` |
| Durable/local state              | `src/state-store.ts`             |
| MeshCore.io queue                | `src/meshcore-io-runtime.ts`     |

## Compatibility decisions

1. General client retain flags are intentionally removed. `/neighbors` is the only retained exception and expires after 48 hours in MQTT and dashboard/API state.
2. Authenticated publishers may publish under `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` when the key matches and the path is not broker-owned/reserved.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not required. Documented non-JSON extensions such as serial response flow remain explicit.
4. Non-admin subscribers remain restricted at subscribe time, with forward-time filtering for private broker data.
5. Swedish CLI, database, and selected runtime log text remains fork-local. Configuration errors, dashboard branding/region UI, and configured secondary-region correction text are neutral English. `allowed_regions`, read-only YAML configuration, integrated target forwarding, and MeshCore.io opt-in remain fork features.
6. Invalid/unlisted IATA publishes are denied events, not abuse mutes by themselves.

Treat publisher authentication, topic/payload acceptance, subscriber roles, `/internal`, `$SYS/*`, `/serial/*`, abuse monitoring/enforcement, target forwarding, and retained-neighbor behavior as compatibility-sensitive. Compare upstream before changing those behaviors and add tests for intentional differences.

## State rules

Durable state belongs in relational tables reflecting the real model, with bound parameters, deterministic ordering, indexes, explicit transactions, bounded queries, and bounded cleanup. Do not recreate a generic Redis/key-value abstraction. Active sockets, observer ownership, subscriber sessions, and rolling metrics are process-local and must not be persisted.

The Aedes adapter must implement the complete operation set actually used by Aedes, not only enough methods to compile. Retained packets, persistent subscriptions, offline queues, QoS state, and wills must recover after restart.

Keep `ARCHITECTURE.md` current for schema, deployment, security, lifecycle, or data-flow changes. Keep `README.md` current for installation, configuration, API, CLI, backup, and compatibility changes.
