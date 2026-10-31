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

For a Traefik deployment, use its public `wss://.../mqtt` URL and pass matching
subscriber, audience and IATA flags. Do not use production credentials in logs
or committed command lines.

This external check complements, rather than replaces, deterministic Rust CI.
Last Will authorization/takeover and role projection remain covered by
`tests/broker_core.rs`, where socket termination and exact packets are
controlled reproducibly.
