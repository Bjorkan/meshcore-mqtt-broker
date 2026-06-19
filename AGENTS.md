# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Future agent work must preserve the MQTT runtime contract exposed by the upstream broker unless a change is explicitly and intentionally documented as a fork-specific compatibility break.

## Compatibility baseline

Before changing broker behavior, compare the relevant behavior with upstream:

- upstream repository: <https://github.com/michaelhart/meshcore-mqtt-broker>
- fork repository: <https://github.com/Bjorkan/meshcore-mqtt-broker>

The default expectation is that existing MeshCore MQTT observers that work with upstream should also work with this broker, except for the intentional fork decisions documented below.

## Current fork compatibility decisions

These decisions are part of the fork contract and should guide future fixes:

1. **MQTT retained publishes:** removing the MQTT retained flag is an intentional fork feature. Client publishes should not create retained MQTT state unless this project explicitly changes that decision later.
2. **Publisher subtopics:** move back toward upstream's more permissive behavior. An authenticated publisher should be allowed to publish under `meshcore/{IATA_OR_TEST}/{ITS_OWN_PUBLIC_KEY}/{subtopic}` when the topic public key matches the authenticated public key and the subtopic is not a documented broker-owned or reserved path.
3. **Packet payload shape:** move back toward upstream behavior. For normal JSON publishes, require valid JSON with `origin_id` matching the authenticated public key. A `raw` field should not be required by default unless a future setting explicitly enables stricter validation.
4. **Subscriber subscribe-time policy:** keep the forked behavior. Non-admin subscribers may be restricted at subscribe time to public MeshCore topics and explicitly documented broker topics such as heartbeat, while forward-time filtering still protects sensitive broker-owned data.

## Intentional fork features

The following fork-specific features are expected and may remain, but they should not accidentally break the upstream MQTT contract beyond their stated purpose:

- Swedish runtime logging and operational text.
- Swedish/allowed-region IATA filtering through `allowed_regions.yaml` and `ALLOWED_REGIONS`.
- The bridge container and Docker/CI packaging split between `broker/` and `bridge/`.
- Retained-flag removal for client publishes.
- Subscribe-time restrictions for non-admin subscriber accounts.
- Hardening that does not reject otherwise upstream-compatible observer traffic by default.

## Behavior that must be checked carefully

Treat these as compatibility-sensitive areas:

- Publisher authentication: `username = v1_{PUBLIC_KEY}` and password is a MeshCore JWT signed for that public key.
- Publisher topic contract: `meshcore/{IATA_OR_TEST}/{PUBLIC_KEY}/{subtopic}` with the authenticated public key matching the topic public key.
- Publisher payload contract: valid JSON with `origin_id` matching the authenticated public key, except for explicitly documented non-JSON extension topics such as serial response flows.
- Retained-message semantics. This fork intentionally strips retained client publishes; upstream retained-state behavior is not the default for this fork.
- Subscriber behavior, including role handling and the intentional fork difference between subscribe-time authorization and forward-time filtering.
- `/internal`, `$SYS/*`, and `/serial/*` visibility rules.
- Abuse detection shadow/enforcement behavior.

## Required workflow for behavior changes

When a change could alter MQTT behavior:

1. Compare the behavior against upstream first.
2. Decide whether the change is an intentional fork feature or a bug.
3. Check the current fork compatibility decisions above before opening issues or changing code.
4. If a difference is intentional, document the compatibility impact in `broker/README.md` and add tests that demonstrate both the fork behavior and the upstream difference.
5. If a difference is not intentional, keep or restore upstream-compatible behavior.
6. Add or update tests in `broker/tests/` so future changes cannot silently drift from the chosen contract.

Do not narrow accepted publisher topics or payload shapes simply because the current fork tests pass. The tests must represent the compatibility contract, not redefine it accidentally.

Keep intentional fork behavior, such as retained-flag removal or non-admin subscribe-time restrictions, unless there is an explicit project decision to change the fork contract.

## Issue and PR expectations

If you find behavior that differs from upstream and is not clearly documented as intentional, open an issue that includes:

- the upstream behavior;
- the fork behavior;
- why existing MQTT observers or admin tooling may be affected;
- what needs to be changed or documented.

If `AGENTS.md` guidance is missing or incomplete, update it in a PR before making broad behavior changes.