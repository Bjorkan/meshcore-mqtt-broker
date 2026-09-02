# MeshCore MQTT Broker

MeshCore MQTT Broker accepts authenticated MeshCore observer data and distributes it to configured MQTT subscribers over WebSocket.

## Features

- Ed25519/JWT observer authentication
- Password-authenticated MQTT subscribers with three access levels
- Durable PostgreSQL storage for MQTT sessions, retained packets, and accepted history
- Optional channel decryption at ingest
- Optional target MQTT forwarding and MeshCore.io advert upload

## Quick Start

Set `auth.expected_audience` and at least one subscriber in `config.yaml`.

For deployment alongside MeshDB on auth.se, copy `compose.postgres.yaml.example` to `compose.yaml` after the following pre-provisioning:

- The `meshdb_database` and `backend` Docker networks must already exist, and the MeshDB PostgreSQL service must be reachable as `meshdb-postgres` on `meshdb_database`.
- Provision with `postgres/initdb/01-meshcore-bootstrap.sql` and its included `02-meshcore-schema.sql.inc` asset using a PostgreSQL/Timescale image that includes both PostGIS and TimescaleDB. The bootstrap creates `meshcore`, verifies both extensions in that database, and installs the complete schema, metadata marker, projections, and triggers as `meshcore_owner`. A reachable incompatible application database gets one bounded compatible migration attempt and is otherwise reprovisioned; authentication, permissions, network, and PostgreSQL infrastructure failures are never reset.
- Create `postgres/secrets/meshcore-broker-password` with only that role's password. It must be readable by container user `bun` (UID 1000) and not readable by group or other users, for example `chown 1000:1000 postgres/secrets/meshcore-broker-password && chmod 0400 postgres/secrets/meshcore-broker-password`.

The example uses `DATABASE_*` environment variables and mounts no broker data directory. On `auth.se`, MeshDB is reachable as `meshdb` on the external `postgresdb_db-internal` network. The broker has no host port mapping: the existing `backend` network alias `meshcore-mqtt-broker` preserves the current reverse-proxy route.

Then run:

```bash
docker compose up -d
```

The Compose example maps `ws://localhost:443` to the broker's plain HTTP/WebSocket listener on port `8883`. Terminate TLS before the container when using `wss://`.

## Clients

Observers authenticate with `v1_<PUBLIC_KEY>` and a signed JWT, then publish to `meshcore/<IATA>/<PUBLIC_KEY>/<SUBTOPIC>`. IATA is the uppercase three-letter geographic MQTT ingress code. It is not a MeshCore region; MeshCore logical regions are represented by neighbor scopes. Subscribers authenticate with an account from `subscribers.users`.

Normal observer publishes require valid JSON whose `origin_id` matches the authenticated public key. Production enables the configured `allowed_iata` allowlist. The non-IATA `test` ingress is disabled by default and, if explicitly enabled for compatibility with `iata.allow_test_ingress`, is never normalized into MQTT history. Publisher retain flags are removed except for exact `/neighbors` topics, which expire after 48 hours. The deprecated `/raw` subtopic is always discarded; publish raw MeshCore bytes inside `/packets` JSON instead.

## Operations

Production storage is the pre-provisioned PostgreSQL database configured by the Compose example.

```bash
docker compose logs -f meshcore-mqtt-broker
docker compose exec --user bun meshcore-mqtt-broker mc-mqtt status
curl http://localhost:443/status
```

The broker exposes MQTT over WebSocket plus `GET /status` on the same listener. Status reports schema version, persisted UTC database-generation creation time, derived age, and the process-local automatic reset count. It does not serve a dashboard, domain REST API, OpenAPI document, MCP endpoint, or frontend assets.

History storage is split in schema v12: `storage.raw_retention_days` bounds replayable MQTT payloads, while `storage.normalized_retention_days` independently controls normalized time/history facts (`0` keeps them indefinitely). Compact provenance and current node/observer/packet identities survive raw payload expiry. Observer metrics are stored once in a private Timescale hypertable and exposed publicly through `meshcore_public.observer_metrics`.

For an existing schema, `bun run db:migrate` performs the bounded semantic migration. The potentially long conversion of an existing ordinary observer-metrics table to Timescale is intentionally separate: after backup/quiescing writes, run `DATABASE_URL=... bun run db:optimize-timescale`. Production query diagnostics can be captured with `DATABASE_URL=... bun run db:performance-snapshot`; SQL text, credentials, and MQTT payloads are omitted.

## CI

Pull requests and pushes must pass build, lint, PostgreSQL functional tests, and the isolated full-day ingest benchmark. CI uses a disposable `meshcore_test` PostgreSQL database with no secrets; the benchmark explicitly confirms its dedicated test-database connection.

See [CONFIGURATION.md](CONFIGURATION.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), and [SECURITY.md](SECURITY.md).
