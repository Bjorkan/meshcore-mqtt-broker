# Security Policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for
`Bjorkan/meshcore-mqtt-broker`. Do not publish subscriber credentials,
JWTs, signing keys, target-MQTT passwords or sensitive configuration.

## Deployment considerations

- The broker listens for **plain MQTT-over-WebSocket**. Terminate public
  `wss://` TLS at Traefik or another trusted proxy. CrowdSec/Traefik
  handle network-edge blocking and rate limiting; the broker still enforces
  MQTT authentication, authorization, payload limits and subscriber limits.
- **`GET /status` is implemented and unauthenticated** on the shared listener
  and is used by the container healthcheck. Restrict it at the reverse proxy
  if you do not want process metadata and counters publicly available.
  Never include credentials or signing keys in this response.
- Protect the read-only `config.yaml` and use unique, strong subscriber and
  optional Target MQTT credentials. No application state or instance ID is
  written to the config file; there is no durable broker data volume.
- MQTT sessions, wills, observer ownership, integration queues and retained
  messages live only in RAM. **Retained messages have no 10,000-topic limit
  and no implicit 48-hour TTL.** They remain until replaced, explicitly
  cleared, expired via an MQTT 5 Message Expiry Interval, or process restart.
  Plan and monitor memory/resource usage accordingly.
- A separate Target MQTT broker can retain forwarded messages persistently
  after this broker restarts. Review its credentials, retention policy and
  topic access independently.
- Outgoing `mqtts://` Target connections should validate both certificate
  chains and hostnames by default. The minimal `scratch` runtime ships
  Debian's CA bundle at `/etc/ssl/certs/ca-certificates.crt` and points
  OpenSSL at it via `SSL_CERT_FILE`; verify CA certificate discovery with a
  real `mqtts://` target before production, and mount a private CA explicitly
  when the Target uses one. Only disable validation for explicitly accepted
  tests.
- Treat `meshcore_io.private_key` as a secret. Review outbound
  MeshCore.io uploads and request-signing behavior before enabling them.
  Test with synthetic keys and do not log private signing material.

## Release image posture

- Multi-architecture release images are built per-architecture, pushed as
  immutable `sha-...-amd64`/`sha-...-arm64` tags, and CVE-scanned by their
  digest before the human-facing `sha-...`/`latest` manifests are promoted.
  The per-arch tags are a deliberate staging exposure (a failing image is
  still addressable by its platform tag), while `latest` never points at an
  unapproved image. Verify the digest-gated promotion in
  `.github/workflows/build-image-broker.yml` before changing it.
