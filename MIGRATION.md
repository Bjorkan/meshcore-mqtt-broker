# Migration Notes

This release removes the broker-owned dashboard, REST API, OpenAPI document, Swagger UI, MCP endpoint, and frontend assets. Only MQTT over WebSocket remains on `mqtt.host` and `mqtt.ws_port`.

The deprecated MQTT `/raw` subtopic is discarded before delivery, forwarding, storage, or processing. Publishers must place raw MeshCore bytes in `/packets` JSON instead.

Schema version 6 renames MQTT ingress `region` fields and `observer_region_history` to canonical `iata` terminology, adds uppercase three-letter IATA checks, and leaves neighbor `scope` tables unchanged because scopes are MeshCore logical regions. This is a clean-install schema change: existing prelaunch data must be reprovisioned rather than migrated so non-IATA or misclassified ingress data cannot survive.

Schema version 7 adds `self_scopes_named_json` to `neighbor_snapshots` and `scopes_named_json` to `neighbor_entries` (private and public projections). Region scopes are normalized to canonical lowercase (`se`, `seXX`, `seXXXX`); the named JSON carries each scope's Swedish administrative name on a separate field, falling back to the scope code when no name is registered. This additive column change follows the clean-install lifecycle and requires reprovisioning.

Schema version 8 adds the public `region_scopes` registry table with `region`, `name`, `first_seen_at_ms`, `last_seen_at_ms`, `manually_added`, and `observation_count`. The broker seeds every built-in Swedish scope (`se`, `seXX` county, `seXXXX` municipality; municipality names hardcoded from the official Swedish municipality list) as `manually_added` at startup and upserts any scope detected in neighbor evidence. Clean-install lifecycle applies; reprovisioning is required.

Schema version 9 makes the registry a derived aggregate (rebuildable from retained neighbor scope evidence), stores the real owner public key on private advert rows so trusted node state — including `owner_public_key` — can be rebuilt from retained verified adverts, adds `observers.latest_iata_event_id` so latest-IATA selection is deterministic on `(received_at_ms, event_id)` ties, and replaces the schema-marker hash with a real SHA-256 fingerprint of the canonical public database contract. A freshly provisioned database from the static initdb asset stores `pending`; the first broker start computes and persists the fingerprint, and both the broker and the Meshat.se REST API refuse readiness whenever the stored fingerprint no longer matches a live recomputation. Clean-install lifecycle applies; reprovisioning is required.

New configuration uses `iata.allowlist_enabled`, `iata.allow_test_ingress`, `allowed_iata`, and `secondary_iata`. The shipped `IATA_whitelist`, `allowed_regions`, and `secondary_region` names remain read-compatible aliases that map only to IATA.

Remove `branding`, `mcp`, and `public_tool_api` configuration sections. Clients using HTTP routes must move to MQTT or an external service. The embedded database remains a clean-install schema: incompatible databases are deleted at broker startup and recreated without migration.
