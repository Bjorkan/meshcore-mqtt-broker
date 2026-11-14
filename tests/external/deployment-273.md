# Issue #273: deployment verification

Run on 2026-11-15 against the Docker deployment reached via `jesper@auth.se`.
Public endpoint: `https://meshcore-mqtt.meshat.se`, Traefik v3.7.18.
Tested deployed broker image ID:
`sha256:84c51da84ef7a4609e173567f3bc032f0683b1d330927c369db84cdbf7fcec64`.
The host/image architecture is AMD64. The image has no source revision label
or repository digest, so these results identify the local image artifact,
not a proven Git commit. It runs as `65532:65532` with read-only configuration.

## Results

| Boundary | Result and evidence |
| --- | --- |
| Actual Beacon configuration | The running Beacon account matches a broker FULL_ACCESS account (role 2); its password matches. Credentials were compared on the server and never printed. |
| Production `/mqtt` | Actual Eclipse Paho Go v1.5.1 connected over verified public WSS, subscribed to `meshcore/#` at QoS 1, disconnected, reconnected and resubscribed. Two 30-second windows observed live packets/status and retained status/neighbors. Window 1: 61 packets, 13 status; window 2: 112 packets, 22 status. Each replay contained 143 status and 1 neighbors. No live neighbors or retained packets appeared; their absence is not a retention failure. |
| Isolated WSS through actual Traefik | Same deployed image, synthetic FULL_ACCESS account and random Ed25519 observer. QoS 1 status/PUBACK, QoS 0 packets/neighbors, exact live payloads, reconnect/resubscribe and exact retained payloads/flags for all three topics passed. A temporary path was stripped before forwarding to `/mqtt`. No synthetic messages entered production Beacon or external integrations. |
| Target TLS in deployed scratch image | Trusted synthetic CA with correct hostname connected. Wrong hostname and untrusted CA were rejected. Killing/restarting the synthetic TLS server caused disconnect/reconnect. Publishes during the outage produced drops with zero successful writes; publishes after recovery produced successful writes. |
| MeshCore.io in deployed scratch image | Synthetic signed ADVERT entered through MQTT. The HTTP server independently verified every upload's Ed25519 signature over SHA-256(data), envelope, link and radio parameters. HTTP 400 produced exactly one request. HTTP 408/429/500/503 and a request timeout each retried once and recovered on 200. Retry data remained identical. Stopping during an outstanding verified request exited cleanly with code 0 in 0.10 seconds. |
| Production integrations | Initial status: 173 observers, Target connected with 1,194,249 successful messages and 0 drops; MeshCore.io 17,102 completed and 968 dropped uploads. Counters continued advancing during testing. Historical drops have no recorded reason in `/status`; they are not evidence of a new regression. `completedUploads` counts terminal HTTP rejections as finished jobs, not only accepted uploads. |
| Repository checks | Rust fmt, all-target check, Clippy with warnings denied, 96 all-target tests (79 unit + 15 broker wire + 2 Target network), doctests, release build and Compose validation passed. Go probe race tests, local Paho integration, shell syntax and Python parsing passed. Loopback Rust tests initially failed in the sandbox; rerunning unchanged with socket access passed. |

The probe previously accepted any three JSON deliveries, so unrelated traffic
or duplicate topics could falsely satisfy the check. It now checks the unique
observer's canonical uppercase topic, exact payload and expected retain flag.
Regression tests reject unrelated/duplicate messages and incorrect payloads or
flags. Probe setup failures during this investigation were corrected before
the passing runs above; no broker runtime change was needed.

## Reproduction and limits

Build `tests/external/beacon-paho` and `tests/external/target-tls/server.go` for
the deployment host, then run the commands in [README.md](README.md) using the
exact local image ID. The TLS script accepts `MESHCORE_TEST_IMAGE`,
`MESHCORE_TLS_SERVER` and `MESHCORE_PAHO_CLIENT` to reuse those artifacts.
The HTTP script takes the image ID and Paho binary as positional arguments.
Temporary containers, routes, keys and files are removed by the runners.

No production broker restart or configuration change was required. Physical
observer firmware was not actively disconnected or taken over; Last Will and
takeover remain covered by the Rust wire suite. Beacon-style Paho tests are
not a controlled reconnect test of the running Beacon application itself.
ARM64 on a real deployment, container queue saturation, and public MeshCore.io
failure injection remain unverified here. The public service was observed
through real uploads; HTTP errors were injected only into isolated containers.
Issue #273 should stay open for the physical-firmware/platform gaps.
