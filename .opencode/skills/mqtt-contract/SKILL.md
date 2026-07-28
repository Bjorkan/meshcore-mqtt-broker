---
name: mqtt-contract
description: Preserve and review the broker's compatibility-sensitive MQTT authentication, topic, payload, subscription, retain, abuse, forwarding, and serial behavior.
compatibility: opencode
metadata:
  domain: mqtt
  risk: high
---

# MQTT contract

`AGENTS.md` and `src/AGENTS.md` are authoritative. Treat this skill as a review checklist, not a replacement.

## Binding fork decisions

1. General client retain flags are removed. `/neighbors` is the only retained exception and expires after 48 hours in broker persistence and dashboard/API state.
2. An authenticated publisher may publish only below `meshcore/{IATA_OR_TEST}/{OWN_PUBLIC_KEY}/{subtopic}` when its key matches and the path is not broker-owned or reserved.
3. Normal JSON publishes require valid JSON and matching `origin_id`; `raw` is not generally required. Explicit non-JSON extensions such as serial response flow remain narrow exceptions.
4. Non-admin subscribers are restricted at subscribe time and private broker data is filtered again at forward time.
5. `allowed_regions`, read-only YAML configuration, Swedish denial/warning wording, target forwarding, and MeshCore.io opt-in are intentional fork features.
6. Invalid or unlisted IATA publishes are denial events, not abuse mutes by themselves.

## High-risk paths

- JWT/public-key authentication and expected audience.
- Public-key ownership in topic path and payload `origin_id`.
- IATA and `TEST` handling, including primary/secondary county codes.
- Broker-owned and reserved namespaces: `/internal`, `$SYS/*`, `/serial/*`, health topics, and other generated paths.
- Subscriber role filters, wildcard normalization, and forward-time private-data filtering.
- Retained neighbor acceptance, expiry, target-broker clear scheduling, and dashboard expiry.
- Abuse detection state, shadow mode, enforcement, denial history, and expiry.
- Target bridge prefixing, retained handling, reconnect behavior, and duplicate delivery.
- Serial request/response extensions and non-JSON boundaries.
- Observer ownership, will handling, reconnect, and stale-session races.

## Change procedure

1. Trace authentication, authorization, payload validation, persistence, publish, forwarding, and dashboard observation as one end-to-end path.
2. Test both allow and deny cases, including malformed topic, wrong key, wrong `origin_id`, invalid JSON, reserved path, forbidden subscription, and reconnect state.
3. Verify the intended reason and wording for denials separately from abuse enforcement.
4. Check retained semantics locally and on the optional target broker.
5. Verify cleanup and expiry using controlled time where possible.
6. Update README compatibility documentation for intentional user-visible changes.

Never broaden an exception because it is convenient for one test or client.
