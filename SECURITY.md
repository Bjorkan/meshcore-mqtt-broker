# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. Do not include subscriber credentials, JWTs, private keys, database contents, or personal data in public reports.

## Deployment Considerations

- Terminate TLS before the plain MQTT WebSocket listener when using `wss://`.
- Use long random subscriber and target-MQTT passwords and protect `config.yaml`; decryption channel keys are secrets.
- Treat `/data/meshcore-mqtt-broker/` as sensitive because it holds accepted MQTT payloads, broker state, retained packets, sessions, queues, and wills.
- The broker has no dashboard, REST API, OpenAPI, MCP, or browser frontend HTTP surface. MQTT subscriber roles apply only to MQTT.
- Review optional target MQTT forwarding and MeshCore.io upload before enabling them.
- Stop the container before copying the database for a consistent backup. Incompatible schemas are deleted on broker startup without an automatic backup.
