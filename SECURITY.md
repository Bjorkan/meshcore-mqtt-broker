# Security Policy

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. If private reporting is unavailable, contact the repository maintainers through a private channel before publishing details.

Include affected versions, impact, reproduction steps, and any proposed mitigation. Do not include real subscriber credentials, JWTs, private keys, database contents, or personal data.

## Deployment considerations

- Put TLS termination and access controls in front of public MQTT WebSocket and dashboard/API listeners where appropriate. The dashboard, JSON APIs, OpenAPI document, and Swagger UI have no built-in authentication, and MQTT subscriber roles do not apply to them.
- Use long random subscriber and target MQTT passwords; do not commit production `config.yaml` credentials.
- Keep `proxy.trust_proxy` disabled unless requests arrive through trusted proxies. When enabled with an empty CIDR setting, loopback IPv4/IPv6 proxies are trusted by default; invalid configured CIDRs are ignored.
- Treat the fixed data directory as sensitive because it contains observer state, trust/denial records, retained packets, persistent MQTT subscriptions, offline QoS queues, wills, verified raw node adverts, per-region hearing history, and integration queues/history. Active sockets and dashboard subscriber-session records are not persisted.
- Stop the container or use a database-aware procedure for backups. Take any required pre-upgrade backup before starting a build with a changed schema, because broker startup permanently deletes incompatible storage without creating a backup.
- `meshcore_io.enabled` and target MQTT forwarding create optional outbound data flows; review them before enabling.
- Anyone who can reach the HTTP listener can read subscriber usernames/client IDs/subscriptions, observer and neighbor state, protection events, integration state, node/observer public keys, verified raw advert packets, coordinates when present, and region-hearing times. Restrict this listener when those operational details are sensitive.
- Swagger UI loads only locally bundled allowlisted assets, uses a same-origin content-security policy, and permits GET-only “Try it out”; it does not add authentication to the underlying API.
- Browser map views contact OpenStreetMap or CARTO directly. Ordinary HTTP requests on the MQTT port redirect to YouTube.
- Configured region metadata and the bundled Sweden geofence are local and make no runtime network request.

Rotate any credential that has entered Git history, logs, issue attachments, image layers, or release archives.
