# Security Policy

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. Do not include subscriber credentials, JWTs, private keys, database contents, or personal data in public reports.

## Deployment Considerations

- Terminate TLS before the plain MQTT WebSocket listener when using `wss://`.
- Use long random subscriber and target-MQTT passwords and protect `config.yaml`; decryption channel keys are secrets. `DATABASE_PASSWORD_FILE` is the supported production credential path; a `DATABASE_PASSWORD` environment value is also accepted by the loader but keeps the secret in the process environment instead of a file.
- Treat PostgreSQL access as sensitive: accepted MQTT payloads, broker state, retained packets, sessions, queues, and wills live in the `meshcore` database, not in `/data/meshcore-mqtt-broker/` (that mount only holds the broker instance id and health credentials).
- The broker has no dashboard, REST API, OpenAPI, MCP, or browser frontend HTTP surface beyond the unauthenticated `GET /status` (schema version, generation age, reset count). MQTT subscriber roles apply only to MQTT.
- Review optional target MQTT forwarding and MeshCore.io upload before enabling them.
- History-sensitive operators should run `bun run db:migrate` manually after taking their own PostgreSQL backup. Automatic startup recovery intentionally takes no backup: availability of the broker takes priority over preserving incompatible history, and incompatible schemas are reprovisioned on startup.
