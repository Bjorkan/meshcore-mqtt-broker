# Migration Notes

## Persisted packet format migration (V8 → MESHMQTT1 MessagePack)

Earlier releases persisted Aedes packets in `meshcore_private.retained_packets.packet`, `mqtt_outgoing.packet`, `mqtt_incoming.packet`, and `mqtt_wills.packet` using `node:v8.serialize`. That wire format is Node/V8-specific; rows written by it must not be interpreted by another JavaScript engine.

The broker now persists packets in a portable versioned container: the ASCII magic prefix `MESHMQTT1` followed by one MessagePack document (`@msgpack/msgpack`), produced by `encodeStoredPacket()` and read by `decodeStoredPacket()` in `src/stored-packet-codec.ts`. Function-valued properties are removed before encoding exactly as before; binary values (`payload`, MQTT v5 `correlationData`) use MessagePack's bin format and are restored to `Buffer` on decode. Encoding is deterministic for identical packets.

Staged rollout:

1. Deploy this transition release under Node.js. It writes only the portable format and still reads legacy V8 rows through the transitional reader in `src/stored-packet-codec.ts`.
2. Run `bun scripts/migrate-stored-packets.mjs` against the production database (idempotent, bounded transactional batches, guarded updates). It reports per table: legacy before / migrated / failed / total after / legacy after. Since the fail-closed release this tool refuses any retired Node-V8 row loudly instead of guessing; a historical backfill that still encounters such rows must be completed with the pre-Bun transition release.
3. Verify the report ends with `migration complete` and zero legacy rows, then restart the broker once and confirm retained/QoS/will recovery.
4. Only after step 3 may the Bun-based release replace the Node runtime. Rollback after backfill must target a release that reads the portable format; rolling back to a pure-V8 reader is unsafe because new-format rows would be unreadable to it.

## Historical schema notes

This release removes the broker-owned dashboard, REST API, OpenAPI document, Swagger UI, MCP endpoint, and frontend assets. MQTT over WebSocket and the operational `GET /status` response share `mqtt.host` and `mqtt.ws_port`.

The deprecated MQTT `/raw` subtopic is discarded before delivery, forwarding, storage, or processing. Publishers must place raw MeshCore bytes in `/packets` JSON instead.

Schema version 6 renames MQTT ingress `region` fields and `observer_region_history` to canonical `iata` terminology, adds uppercase three-letter IATA checks, and leaves neighbor `scope` tables unchanged because scopes are MeshCore logical regions. This is a clean-install schema change: existing prelaunch data must be reprovisioned rather than migrated so non-IATA or misclassified ingress data cannot survive.

Schema version 7 adds `self_scopes_named_json` to `neighbor_snapshots` and `scopes_named_json` to `neighbor_entries` (private and public projections). Region scopes are normalized to canonical lowercase (`se`, `seXX`, `seXXXX`); the named JSON carries each scope's Swedish administrative name on a separate field, falling back to the scope code when no name is registered. This additive column change follows the clean-install lifecycle and requires reprovisioning.

Schema version 8 adds the public `region_scopes` registry table with `region`, `name`, `first_seen_at_ms`, `last_seen_at_ms`, `manually_added`, and `observation_count`. The broker seeds every built-in Swedish scope (`se`, `seXX` county, `seXXXX` municipality; municipality names hardcoded from the official Swedish municipality list) as `manually_added` at startup and upserts any scope detected in neighbor evidence. Clean-install lifecycle applies; reprovisioning is required.

Schema version 9 makes the registry a derived aggregate (rebuildable from retained neighbor scope evidence), stores the real owner public key on private advert rows so trusted node state — including `owner_public_key` — can be rebuilt from retained verified adverts, adds `observers.latest_iata_event_id` so latest-IATA selection is deterministic on `(received_at_ms, event_id)` ties, and replaces the schema-marker hash with a real SHA-256 fingerprint of the canonical public database contract. A freshly provisioned database from the static initdb asset stores `pending`; the first broker start computes and persists the fingerprint, and both the broker and the Meshat.se REST API refuse readiness whenever the stored fingerprint no longer matches a live recomputation. Clean-install lifecycle applies; reprovisioning is required.

New configuration uses `iata.allowlist_enabled`, `iata.allow_test_ingress`, `allowed_iata`, and `secondary_iata`. The shipped `IATA_whitelist`, `allowed_regions`, and `secondary_region` names remain read-compatible aliases that map only to IATA.

Remove `branding`, `mcp`, and `public_tool_api` configuration sections. Clients using domain HTTP routes must move to MQTT or an external service.

Schema v10 introduced fingerprint-v2 and timeline indexes. Schema v11 adds persisted `database_created_at`. Startup has one known chain, 9→10→11, under one deadline. Migration is best-effort preservation: failure or timeout falls back to one atomic reprovision of the broker-owned schemas so MQTT can start without needing to terminate REST database sessions. The manual `bun run db:migrate` command uses the same registry but never resets implicitly. A legacy v9/v10 upgrade initializes creation metadata at migration time because no exact older generation timestamp exists.

The Bun-based release removes the transitional V8 reader entirely: `decodeStoredPacket()` rejects rows without the `MESHMQTT1` prefix with an explicit error naming this migration script, so a skipped backfill fails loudly instead of corrupting state.
