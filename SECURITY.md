# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. Do not include subscriber credentials, JWTs, or private keys in public reports.

## Deployment Considerations

- Terminate TLS before the plain MQTT WebSocket listener when using `wss://` (Traefik in front).
- IP blocking and rate limiting at the network edge are handled by CrowdSec/Traefik, not by the broker. The broker's abuse detector only logs observations and never blocks, mutes, or silences.
- Use long random subscriber and target-MQTT passwords and protect `config.yaml`.
- The broker is stateless: MQTT sessions, retained packets, queues, wills, and upload queues live only in process memory. The only mount is the read-only config file; there is no data volume and no persisted instance id or credentials.
  -- The broker has no dashboard, REST API, OpenAPI, MCP, or browser frontend HTTP surface beyond the unauthenticated `GET /status` (`{ status: "ok", storage: "stateless", ... }`, see CONFIGURATION.md). MQTT subscriber roles apply only to MQTT.
- Review optional target MQTT forwarding and MeshCore.io upload before enabling them.
