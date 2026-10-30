# External integration checks

The locked Rust suite remains the deterministic CI baseline. These checks add
real client, container and certificate boundaries without requiring production
credentials or services.

| Check | Boundary | Command |
| --- | --- | --- |
| Beacon/Paho | Actual Eclipse Paho Go client, firmware-style Ed25519 observer, `/mqtt`, QoS 0/1, reconnect and retained replay | `tests/external/run-local-beacon-paho.sh` |
| Target MQTT TLS | Built nonroot `scratch` image, synthetic TLS MQTT server, positive CA/hostname and negative CA/hostname cases | `tests/external/run-target-tls.sh` |
| MeshCore.io | Real loopback HTTP requests, signed-body verification, 400/408/429/5xx classification, recovery and in-flight shutdown | `cargo test --locked meshcore_io` |

Both shell checks create temporary synthetic credentials/configuration and
clean up their process, image and container resources. The TLS check requires
Docker host networking (Linux), Go and OpenSSL. The Paho check requires Go and
`curl`. Public `wss://` reverse-proxy validation can use the Paho program
directly as described in `beacon-paho/README.md`.

These tests do not claim access to a production Beacon deployment, physical
observer hardware or the public MeshCore.io service. Hardware/service-specific
problems should be captured as separate reproducible issues; no production
secrets belong in fixtures or CI.
