# Beacon/Paho external compatibility check

This program uses the actual Eclipse Paho Go client as a FULL_ACCESS Beacon-style
subscriber and as a firmware-style Ed25519 observer. It verifies `/mqtt`, a QoS
1 `meshcore/#` subscription, QoS 1 status PUBACK, QoS 0 packets/neighbors,
disconnect/reconnect, resubscribe and retained replay for all three telemetry
topics. Credentials and the observer key are synthetic; retained fixtures are
cleared before exit.

Run it against a local broker configured with subscriber `full` / `secret`,
allowed IATA `STO` and audience `integration`:

```sh
go run . -url ws://127.0.0.1:8883/mqtt
```

For production, use `-passive -timeout 30s` with its public
`wss://.../mqtt` URL and a FULL_ACCESS subscriber. Set the password using
`MQTT_PASSWORD`; avoid credentials in command arguments and logs. Passive mode
subscribes twice across a disconnect/reconnect and reports observed live/retained
counts by telemetry type without publishing. It requires some live and retained
traffic on each connection, but does not require every type to exist in a short
observation window. Missing types remain unverified by this mode.

Use `../run-deployment-wss.sh` for active deployment checks. It creates an
isolated broker and a temporary path through the actual Traefik endpoint.
Active mode uses a fresh random observer key, verifies all three exact topics,
payloads and retain flags, ignores unrelated traffic, and clears its fixtures
with QoS 1 even after a failed assertion. `-advert` publishes a fresh signed
synthetic ADVERT and radio status for the isolated HTTP image check.

This external check complements, rather than replaces, deterministic Rust CI.
Last Will authorization/takeover and role projection remain covered by
`tests/broker_core.rs`, where socket termination and exact packets are
controlled reproducibly.
