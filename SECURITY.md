# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. Do not include subscriber credentials, JWTs, or private keys in public reports.

## Deployment Considerations

- Terminate TLS before the plain MQTT WebSocket listener when using `wss://` (Traefik in front).
- IP blocking and rate limiting at the network edge are handled by CrowdSec/Traefik, not by the broker. The broker has no abuse detector or IP-blocking subsystem; its MQTT authentication, authorization, payload limits, and subscriber connection limits remain enforced.
- Use long random subscriber and target-MQTT passwords and protect `config.yaml`.
- The broker is stateless: MQTT sessions, retained packets, queues, wills, and upload queues live only in process memory. The only mount is the read-only config file; there is no data volume and no persisted instance id or credentials.
- The Rust migration branch currently exposes only MQTT-over-WebSocket. The
  unauthenticated `GET /status` endpoint is tracked as pending in `RUST.md`.
- Review optional target MQTT forwarding and MeshCore.io upload before enabling them. If configuring `meshcore_io.private_key`, treat `config.yaml` as a secret and keep it out of version control; logs contain only the derived public signing key.
