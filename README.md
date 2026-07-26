# MeshCore MQTT Broker

A single-instance MQTT-over-WebSocket broker for MeshCore observers. One Docker container runs one Node.js process, one Aedes broker, the dashboard/API, the optional MeshCore.io uploader, and one embedded file-backed Turso database.

The broker does not require Internet access unless an optional outbound feature is enabled. It does not use Turso Cloud or any external database service.

Valkey and Redis runtime support have been removed completely; neither service nor any Redis client/adapter is installed.

## Installation model

This release is for a clean installation only.

- Existing Valkey data is not imported.
- Existing installations are not upgraded.
- No schema migration system exists.
- Initial installation requires a clean data directory.
- The application supports only an empty database or a database created by this exact schema implementation.
- If startup reports an incompatible database, stop the container, back up the bind-mounted directory if needed, empty it, and start again.

There is no horizontal scaling, broker replication, distributed coordination, or Docker Swarm deployment mode. Starting multiple broker containers against separate files creates independent brokers and is unsupported. Starting multiple broker processes against the same application database is also unsupported; multi-process WAL is enabled only so `mc-mqtt` can safely inspect and update the database while the broker runs.

## Quick start

1. Review `config.yaml`, especially `auth.expected_audience`, subscriber passwords, and `allowed_regions`.
2. Create the host data directory and grant the container's `node` user permission to it.
3. Start the single service.

```bash
mkdir -p ./data/meshcore-mqtt-broker
docker compose -f compose.yaml.example up -d
```

The example mounts:

```yaml
volumes:
  - ./config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro
  - ./data/meshcore-mqtt-broker:/data/meshcore-mqtt-broker
```

The host path may instead be `/srv/meshcore-mqtt-broker` or another operator-selected directory:

```yaml
volumes:
  - /srv/meshcore-mqtt-broker:/data/meshcore-mqtt-broker
```

The container destination is fixed. Production code always uses:

```text
/data/meshcore-mqtt-broker/
/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db
```

The path is not available through YAML, environment variables, or CLI options. The entrypoint creates only this directory, applies ownership only to the directory itself, verifies read/write access as the non-root runtime user, and then starts the broker. Existing database files must already be accessible to that user; the entrypoint deliberately does not recursively change host files or make the mount world-writable.

Ports:

- `8883`: MQTT over WebSocket
- `8080`: dashboard and HTTP API

## MQTT compatibility

Publishers authenticate with:

- username: `v1_{PUBLIC_KEY}`
- password: a MeshCore JWT signed for that public key

Publisher topics use `meshcore/{IATA_OR_TEST}/{PUBLIC_KEY}/{subtopic}`. The topic key must match the authenticated key. Normal publishes must contain valid JSON whose `origin_id` matches that key. Arbitrary public subtopics remain accepted unless they are documented broker-owned paths. `serial/responses` is the documented non-JSON extension flow.

The fork intentionally strips client retain flags. The exact `/neighbors` subtopic is the only exception: its latest packet is retained and expires after 48 hours. Nested extension topics that merely end in `/neighbors` are not retained. The retained packet, parsed dashboard/API neighbor snapshot, and expiration timestamp survive restart. `/status` is not retained.

Subscriber accounts are configured under `subscribers.users`. Roles remain:

- `1`: admin
- `2`: full access
- `3`: limited

Non-admin subscribe-time restrictions and forward-time filtering protect private `/internal`, `$SYS/*`, and `/serial/*` data. Connection limits are enforced within the single process. Active subscriber sessions are intentionally not durable and are cleared by restart.

When the same observer reconnects, replacement authentication waits for any publish authorization already in flight, then replaces the older connection. Connection object identity fences disconnect callbacks and target forwarding, so an old callback cannot remove or forward for a replacement.

## Durable state

Turso stores:

- retained MQTT packets and their expiration;
- persistent MQTT subscriptions, outgoing queues, QoS 2 incoming packets, and Last Wills;
- observer names and cache expiration;
- latest observer status timestamps used to reject stale status packets;
- observer/dashboard state and 48-hour neighbor snapshots;
- abuse trust state, enforced and shadow-mode mutes;
- denied publish events;
- target-broker retained-neighbor clear deadlines, retried after reconnect/restart;
- MeshCore.io ingress deduplication, radio state, jobs, durable attempts/retries, accepted advert state, history, counters, and map state.

Intentionally process-local state includes active sockets, active subscriber sessions, the current observer connection owner, rolling one-minute metrics, rate-limiter entries, target-bridge connection/counters, and in-flight HTTP requests.

Cleanup is bounded. Expired retained packets, cache rows, trust state, denied events, ingress deduplication, and radio state are deleted in limited batches. Accepted MeshCore.io ingress remains durable for 24 hours independently of the short duplicate-suppression window. MeshCore.io terminal jobs and upload history retain the newest 100 entries; map entries older than seven days are removed. Observer messages are bounded to 50 per observer and dashboard lists use explicit limits.

## MeshCore.io

The integration is opt-in with `meshcore_io.enabled`. A local durable Turso queue validates adverts, deduplicates active jobs, enforces capacity and per-node cooldown, stores attempt counts and retry timestamps, and runs `meshcore_io.workers` local workers. A startup recovers every job left in `processing`; no lease, election, consumer group, or remote worker is involved.

`dry_run: true` exercises validation, queueing, retries, completion, and dashboard reporting without an external upload. Remote HTTP delivery is at-least-once: a process failure after remote acceptance but before local completion can cause a retry, so the receiver's duplicate handling remains important.

## Health check

The image health check performs both:

1. an authenticated MQTT subscribe/publish loopback on the internal health topic;
2. existing-schema validation and a bounded read query through a newly opened Turso connection.

File existence alone is not considered healthy. The probe runs no initialization DDL or destructive database write and cannot redirect the database path.

## Dashboard and API

The dashboard presents one local broker runtime, observers, subscribers, protection events, neighbor state, publish activity, target forwarding, and the local MeshCore.io queue. Legacy `brokers[]`, broker IDs, and summary count fields remain in `/api/dashboard` where useful for client compatibility, but they contain one local broker and no ownership or failover meaning. The obsolete `namespace` field was removed.

Public observer lookup:

```text
GET /api/v1/observers/{PUBLIC_KEY}/status
```

Responses retain `known`, `blocked`, `unknown`, `invalid`, and `error` status behavior. Blocked state takes precedence over known state. Inactive durable observers can remain known, and a recent neighbor snapshot is returned until its 48-hour expiration.

## CLI

The image includes `mc-mqtt`. Run read-only commands in the live container as
the same non-root user as the broker:

```bash
docker compose -f compose.yaml.example exec --user node meshcore-mqtt-broker mc-mqtt status
docker compose -f compose.yaml.example exec --user node meshcore-mqtt-broker mc-mqtt observer list
docker compose -f compose.yaml.example exec --user node meshcore-mqtt-broker mc-mqtt abuse list
```

Stop the broker before a command that changes or resets durable state, then run a one-shot container against the same bind mount:

```bash
docker compose -f compose.yaml.example stop meshcore-mqtt-broker
docker compose -f compose.yaml.example run --rm --no-deps --user node meshcore-mqtt-broker mc-mqtt abuse remove PUBLIC_KEY
docker compose -f compose.yaml.example run --rm --no-deps --user node meshcore-mqtt-broker mc-mqtt abuse clearall
docker compose -f compose.yaml.example run --rm --no-deps --user node meshcore-mqtt-broker mc-mqtt reset
docker compose -f compose.yaml.example up -d
```

The CLI always opens `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db`. It has no path option. `reset` requires confirmation unless `--force` is supplied. It deletes rows only from known application tables; it does not recursively delete the data directory, the database file, configuration, or operator-created files. Mutating CLI commands are offline maintenance operations; running them concurrently with the broker is unsupported.

## Backup and inspection

Stop the container before copying the database directory for the simplest consistent backup. Back up the complete `/data/meshcore-mqtt-broker/` directory, including files associated with the database. If an online backup is required, use a Turso/SQLite-compatible backup procedure rather than copying only the main file while writes are active.

`@tursodatabase/database` is pre-1.0, so regular tested backups are recommended. Linux GNU `amd64` and `arm64` native packages are included by the official package. The Debian-based image supplies the expected glibc environment.

Use `mc-mqtt status` for a bounded database probe and summary. Direct ad-hoc SQL modifications are unsupported and can make the database incompatible.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm run build
npm test
docker build .
docker compose -f compose.yaml.example config
```

Tests use explicit temporary file-backed databases through `openTestDatabase()`. This test-only override is not connected to production configuration, environment variables, Docker settings, or CLI arguments.

## License

[MIT](LICENSE.md)
