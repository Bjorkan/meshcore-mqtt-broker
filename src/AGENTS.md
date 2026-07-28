# Server, MQTT, and persistence instructions

These instructions apply to files under `src/`. Read the root `AGENTS.md` first.

## Read before editing

- `ARCHITECTURE.md` for runtime ownership, schema, lifecycle, and operations.
- `API_DEVELOPMENT.md` for dashboard/public API changes.
- Relevant tests in `tests/`; do not infer behavior from source alone.

Key ownership boundaries:

- `server.ts`: broker construction, MQTT/WebSocket listeners, authentication, authorization, ownership, and shutdown.
- `config.ts`: read-only YAML configuration and strict validation.
- `dashboard.ts`: dashboard snapshots and public observer API.
- `database.ts`: fixed database path, connection, current schema, compatibility validation, and health probe.
- `aedes-persistence-turso.ts`: Aedes retained, subscription, queue, QoS, and will persistence.
- `state-store.ts`: relational broker state plus explicitly process-local sessions.
- `target-bridge.ts`: optional forwarding to the target MQTT broker.
- `meshcore-io-runtime.ts`: bounded queue/workers and durable upload state.

## MQTT fork decisions

Preserve these intentional behaviors unless the task explicitly changes the contract:

1. General client retain flags are removed. `/neighbors` is the only retained exception and expires after 48 hours in MQTT and dashboard/API state.
2. Authenticated publishers may publish under `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` only when the key matches and the path is not broker-owned or reserved.
3. Normal JSON publishes require valid JSON and a matching `origin_id`; `raw` is not required. Explicit non-JSON extensions such as serial response flow remain narrowly defined.
4. Non-admin subscribers are restricted at subscribe time and private broker data is also filtered at forward time.
5. `allowed_regions`, read-only YAML configuration, “Nekad”/“Varnas” wording, integrated target forwarding, and MeshCore.io opt-in are fork features.
6. Invalid or unlisted IATA publishes are denied events, not abuse mutes by themselves.

Treat these as high-risk paths:

- JWT/public-key identity binding and publisher ownership,
- IATA and `TEST` handling,
- `origin_id` validation,
- `/internal`, `$SYS/*`, `/serial/*`, and other reserved namespaces,
- subscriber role filtering and wildcard subscriptions,
- abuse shadow mode versus enforcement,
- target forwarding and retain normalization,
- retained `/neighbors` storage, cleanup, and replay,
- orphaned wills and reconnect ownership.

Trace allow and deny paths and add tests for both. Compare upstream before changing ambiguous behavior.

## Database and state rules

- Production uses one managed embedded Turso connection at the fixed path from the root instructions.
- Keep the direct idempotent current-schema initializer; do not add migrations or a schema-version framework.
- Durable state belongs in relational tables that model the real domain. Do not recreate a generic Redis/key-value abstraction.
- Active sockets, observer ownership, subscriber sessions, and rolling metrics are process-local and must not be persisted.
- Use bound parameters, deterministic ordering, bounded reads, indexes, explicit transactions for multi-step invariants, and bounded cleanup.
- Track asynchronous database operations and close only after owned work settles.
- The Aedes adapter must implement the complete operation set actually used by Aedes. Verify retained packets, persistent subscriptions, offline queues, QoS state, and wills across restart.

## Runtime and lifecycle rules

- Every listener, timer, worker, retry, queue, and database operation must have a clear owner and shutdown path.
- Do not add unbounded queues, recursive retries, duplicate intervals, hidden background promises, or mutable singleton state without lifecycle ownership.
- Configuration parsing must fail clearly on invalid values. Do not silently coerce unsupported values.
- HTTP/API output must be bounded and must not leak secrets or private subscriber data.
- Keep health checks representative of the real broker path rather than process-alive checks.

## Verification map

Run `npm run build:server` after server-side TypeScript changes. Use the focused matching test, then the broader suite. Common mappings:

| Area                               | Tests                                                          |
| ---------------------------------- | -------------------------------------------------------------- |
| Authentication, runtime, ownership | `tests/runtime-local.test.mjs`                                 |
| Abuse and rate limits              | `tests/abuse-detector.test.mjs`, `tests/rate-limiter.test.mjs` |
| Neighbors                          | `tests/neighbors.test.mjs`                                     |
| Target forwarding                  | `tests/target-bridge.test.mjs`                                 |
| Database/schema                    | `tests/database.test.mjs`                                      |
| Aedes persistence/restart          | `tests/aedes-persistence-turso.test.mjs`                       |
| Durable/local state                | `tests/state-store.test.mjs`                                   |
| MeshCore.io                        | `tests/meshcore-io-local.test.mjs`                             |
| Dashboard API helpers              | `tests/dashboard-helpers.test.mjs`                             |
| Config, CLI, health                | corresponding `tests/*-local.test.mjs` or module test          |

Update `ARCHITECTURE.md`, `README.md`, or `API_DEVELOPMENT.md` whenever their contract changes.
