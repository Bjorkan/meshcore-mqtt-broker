# Security Policy

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Use GitHub's private vulnerability reporting for `bjorkan/meshcore-mqtt-broker`. If private reporting is unavailable, contact the repository maintainers through a private channel before publishing details.

Include affected versions, impact, reproduction steps, and any proposed mitigation. Do not include real subscriber credentials, JWTs, private keys, database contents, or personal data.

## Deployment considerations

- Put TLS termination and access controls in front of the public shared MQTT WebSocket, MCP, and dashboard/API listener where appropriate. The Node.js listener is plain HTTP/WebSocket. The MCP endpoint, dashboard, JSON APIs, OpenAPI document, and Swagger UI have no built-in authentication, and MQTT subscriber roles do not apply to them.
- Use long random subscriber and target MQTT passwords; do not commit production `config.yaml` credentials.
- Keep `proxy.trust_proxy` disabled unless requests arrive through trusted proxies. When enabled with an empty CIDR setting, loopback IPv4/IPv6 proxies are trusted by default; invalid configured CIDRs are ignored.
- Treat the fixed data directory as sensitive because it contains byte-for-byte accepted public MQTT payloads, RF metadata, observer/node identities, decoded message or telemetry content when available, processing errors, trust/denial records, retained packets, persistent MQTT subscriptions, offline QoS queues, wills, verified raw node adverts, per-region hearing history, and integration queues/history. Active sockets and dashboard subscriber-session records are not persisted.
- Stop the container or use a database-aware procedure for backups. Take any required pre-upgrade backup before starting a build with a changed schema, because broker startup permanently deletes incompatible storage without creating a backup.
- `meshcore_io.enabled` and target MQTT forwarding create optional outbound data flows; review them before enabling.
- Anyone who can reach the HTTP listener can read subscriber usernames/client IDs/subscriptions, observer and neighbor state, protection events, integration state, node/observer public keys, verified raw advert packets, coordinates when present, and region-hearing times. Restrict this listener when those operational details are sensitive.
- Anyone who can reach `/mcp/v2` can anonymously query bounded normalized public history, including complete public keys, public advert locations, decoded allowlisted fields, raw public packet bytes, RF observations, paths, traces, telemetry, and available public message plaintext. The MCP surface deliberately excludes subscriber/socket data, credentials, private/internal topics, generic raw MQTT payloads, generic SQL, and filesystem access.
- Every MCP and `/api/v2/tools/*` result is recursively checked immediately before serialization by the same policy and must match its registered strict output schema. The policy is field- and source-based: sensitive field names are blocked at any nesting level, and values that originate from the public MeshCore `/status`, `/packets`, and `/neighbors` feeds are preserved even when they look like e-mail addresses or IP addresses, while `mqtt.email`, real broker client/connection IP fields, and credentials never enter the public DTO. Unsupported, schema-invalid, excessively complex, or over-4-MiB output fails closed. Transport errors do not expose SQL, paths, stack traces, or exception details. Keep the shared registry, policy, and adversarial parity tests in place when adding tools.
- The shared listener applies bounded request/header/keep-alive timeouts, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`. Reverse proxies should enforce compatible or stricter limits without shortening valid MQTT WebSocket upgrades.
- Swagger UI loads only locally bundled allowlisted assets, uses a same-origin content-security policy, and permits only read-only GET and public-tool POST operations in “Try it out”; it does not add authentication to the underlying API.
- Browser map views contact OpenStreetMap or CARTO directly.
- Configured region metadata and the bundled Sweden geofence are local and make no runtime network request.

Rotate any credential that has entered Git history, logs, issue attachments, image layers, or release archives.
