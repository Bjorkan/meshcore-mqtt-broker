# Security Policy

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. If private reporting is unavailable, contact the repository maintainers through a private channel before publishing details.

Include affected versions, impact, reproduction steps, and any proposed mitigation. Do not include real subscriber credentials, JWTs, private keys, database contents, or personal data.

## Deployment considerations

- Put TLS termination and access controls in front of public MQTT WebSocket and dashboard listeners where appropriate.
- Use long random subscriber and target MQTT passwords; do not commit production `config.yaml` credentials.
- Keep `proxy.trust_proxy` disabled unless requests arrive only through explicitly trusted proxy CIDRs.
- Treat the fixed data directory as sensitive because it contains observer, subscriber-session history, denial, and MQTT persistence data.
- Stop the container or use a database-aware procedure for backups.
- `meshcore_io.enabled` and target MQTT forwarding create optional outbound data flows; review them before enabling.
- Browser map views contact OpenStreetMap or CARTO directly. Ordinary HTTP requests on the MQTT port redirect to YouTube.
- Region metadata is local configuration and makes no network request.

Rotate any credential that has entered Git history, logs, issue attachments, image layers, or release archives.
