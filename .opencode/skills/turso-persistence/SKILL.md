---
name: turso-persistence
description: Design and review the embedded file-backed Turso schema, Aedes adapter, relational state, lifecycle, cleanup, and restart recovery under the project's single-instance contract.
compatibility: opencode
metadata:
  domain: database
  engine: turso
---

# Embedded Turso persistence

## Non-negotiable constraints

- One embedded file-backed Turso database owned by the single Node.js process.
- Production directory and file are hardcoded in `src/database.ts`:
  - `/data/meshcore-mqtt-broker/`
  - `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db`
- No environment variable, YAML setting, CLI flag, bind-path abstraction, external database, cloud database, replica, or coordination service.
- Clean-install schema only. No migrations, schema versions, import, repair runner, rollback, legacy compatibility, or ORM synchronization.
- Existing marked databases are validated before DDL. Incompatible databases fail with clear clean-directory instructions.

## Relational design rules

- Model real entities and relationships; do not recreate Redis or a generic key/value layer.
- Use bound parameters for every value.
- Use explicit transactions for multi-step invariants.
- Give reads deterministic ordering and hard bounds.
- Use indexes matching cleanup, replay, identity, and ordering queries.
- Use keyset pagination for ordered replay where offsets can become expensive or unstable.
- Keep expiration and cleanup bounded and idempotent.
- Keep active sockets, ownership, subscriber sessions, and rolling metrics process-local.

## Aedes adapter review

Verify all operations Aedes actually uses:

- retained packet store/retrieve/remove and wildcard retrieval,
- persistent subscriptions,
- outgoing offline queues and ordered replay,
- incoming QoS 2 state,
- outgoing packet/message ID state,
- wills and orphaned wills,
- stream behavior, callbacks/promises, and cleanup,
- restart recovery and graceful close.

Compilation is not proof of adapter correctness.

## Lifecycle

- Storage directory validation and database probe complete before MQTT or HTTP listeners start.
- Health and CLI validation paths do not initialize or mutate schema unexpectedly.
- Shutdown stops new ownership and listeners, drains tracked work, then closes Turso after operations settle.
- Tests use only explicit test database factories/dependencies and clean temporary locations.

## Documentation

Update `ARCHITECTURE.md` for schema, index, lifecycle, recovery, or data-flow changes. Update `README.md` for backup, inspection, reset, and operational behavior.
