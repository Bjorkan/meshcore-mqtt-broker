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
- Provision with `postgres/initdb/01-meshcore-bootstrap.sql` and its included `02-meshcore-schema.sql.inc` asset using a PostgreSQL/Timescale image that includes both PostGIS and TimescaleDB. The bootstrap creates `meshcore`, verifies both extensions in that database, and installs the complete schema, metadata marker, projections, and triggers as `meshcore_owner`. The `meshcore_broker` login only validates the provisioned schema and performs DML at runtime.
- Create `postgres/secrets/meshcore-broker-password` with only that role's password. It must be readable by container user `node` (UID 1000) and not readable by group or other users, for example `chown 1000:1000 postgres/secrets/meshcore-broker-password && chmod 0400 postgres/secrets/meshcore-broker-password`.

The example uses `DATABASE_*` environment variables and mounts no broker data directory. On `auth.se`, MeshDB is reachable as `meshdb` on the external `postgresdb_db-internal` network. The broker has no host port mapping: the existing `backend` network alias `meshcore-mqtt-broker` preserves the current reverse-proxy route.

Then run:

```bash
docker compose up -d
```

The Compose example maps `ws://localhost:443` to the broker's plain HTTP/WebSocket listener on port `8883`. Terminate TLS before the container when using `wss://`.

## Clients

Observers authenticate with `v1_<PUBLIC_KEY>` and a signed JWT, then publish to `meshcore/<REGION>/<PUBLIC_KEY>/<SUBTOPIC>`. Subscribers authenticate with an account from `subscribers.users`.

Normal observer publishes require valid JSON whose `origin_id` matches the authenticated public key. Publisher retain flags are removed except for exact `/neighbors` topics, which expire after 48 hours. The deprecated `/raw` subtopic is always discarded; publish raw MeshCore bytes inside `/packets` JSON instead.

## Operations

Production storage is the pre-provisioned PostgreSQL database configured by the Compose example.

```bash
docker compose logs -f meshcore-mqtt-broker
docker compose exec --user node meshcore-mqtt-broker mc-mqtt status
```

The broker exposes MQTT over WebSocket only. It does not serve a dashboard, REST API, OpenAPI document, MCP endpoint, or frontend assets.

## CI

Pull requests and pushes must pass build, lint, PostgreSQL functional tests, and the isolated full-day ingest benchmark. CI uses a disposable `meshcore_test` PostgreSQL database with no secrets; the benchmark explicitly confirms its dedicated test-database connection.

See [CONFIGURATION.md](CONFIGURATION.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), and [SECURITY.md](SECURITY.md).
