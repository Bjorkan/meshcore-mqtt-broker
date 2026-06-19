# Agent Instructions

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. Future agent work must preserve the MQTT runtime contract exposed by the upstream broker unless a change is explicitly and intentionally documented as a fork-specific compatibility break.

## Compatibility baseline

Before changing broker behavior, compare the relevant behavior with upstream:

- upstream repository: <https://github.com/michaelhart/meshcore-mqtt-broker>
- fork repository: <https://github.com/Bjorkan/meshcore-mqtt-broker>

The default expectation is that existing MeshCore MQTT observers that work with upstream should also work with this broker.

## Intentional fork features

The following fork-specific features are expected and may remain, but they should not accidentally break the upstream MQTT contract beyond their stated purpose:

- Swedish runtime logging and operational text.
- Swedish/allowed-region IATA filtering through `allowed_regions.yaml` and `ALLOWED_REGIONS`.
- The bridge container and Docker/CI packaging split between `broker/` and `bridge/`.
- Security hardening that does not reject otherwise upstream-compatible observer traffic by default.

## Behavior that must be checked carefully

Treat these as compatibility-sensitive areas:

- Publisher authentication: `username = v1_{PUBLIC_KEY}` and password is a MeshCore JWT signed for that public key.
- Publisher topic contract: `meshcore/{IATA_OR_TEST}/{PUBLIC_KEY}/{subtopic}` with the authenticated public key matching the topic public key.
- Publisher payload contract: valid JSON with `origin_id` matching the authenticated public key, except for explicitly documented non-JSON extension topics such as serial response flows.
- Retained-message semantics, including upstream's status retain handling and admin retained-message deletion behavior.
- Subscriber behavior, including role handling and the difference between subscribe-time authorization and forward-time filtering.
- `/internal`, `$SYS/*`, and `/serial/*` visibility rules.
- Abuse detection shadow/enforcement behavior.

## Required workflow for behavior changes

When a change could alter MQTT behavior:

1. Compare the behavior against upstream first.
2. Decide whether the change is an intentional fork feature or a bug.
3. If it is intentional, document the compatibility impact in `broker/README.md` and add tests that demonstrate both the fork behavior and the upstream difference.
4. If it is not intentional, keep or restore upstream-compatible behavior.
5. Add or update tests in `broker/tests/` so future changes cannot silently drift from the chosen contract.

Do not narrow accepted topics, payload shapes, retain behavior, or subscriber permissions simply because the current fork tests pass. The tests must represent the compatibility contract, not redefine it accidentally.

## Issue and PR expectations

If you find behavior that differs from upstream and is not clearly documented as intentional, open an issue that includes:

- the upstream behavior;
- the fork behavior;
- why existing MQTT observers or admin tooling may be affected;
- what needs to be changed or documented.

If `AGENTS.md` guidance is missing or incomplete, update it in a PR before making broad behavior changes.