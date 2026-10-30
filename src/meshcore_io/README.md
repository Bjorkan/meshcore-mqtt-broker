# MeshCore.io integration

This module accepts authorized observer telemetry from the MQTT broker,
extracts and verifies MeshCore ADVERT packets, enriches them with remembered
radio state, signs the MeshCore.io request, and uploads it through bounded
in-memory workers.

## Processing pipeline

```text
MQTT status ───────────────→ remembered radio parameters
                                  │
MQTT packets → ADVERT decode → signature verification → bounded queue
                                                      → signed HTTP upload
```

All state is process-local. Restarting the broker clears ingress deduplication,
observer radio state, cooldowns, queued jobs, retries, and counters.

## Files

| File | Responsibility |
| --- | --- |
| [`runtime.rs`](runtime.rs) | Coordinates ingress, queue admission, workers, counters, cleanup, and shutdown. |
| [`ingress.rs`](ingress.rs) | Validates MQTT ingress and extracts packet candidates. |
| [`advert.rs`](advert.rs) | Parses and cryptographically verifies firmware ADVERT packets. |
| [`radio.rs`](radio.rs) | Normalizes radio parameters from observer status payloads. |
| [`queue.rs`](queue.rs) | Job state, admission outcomes, cooldowns, and queue statistics. |
| [`signing.rs`](signing.rs) | Produces the signed MeshCore.io request envelope. |
| [`poster.rs`](poster.rs) | Sends HTTP requests and classifies accepted, permanent, and retryable results. |
| [`types.rs`](types.rs) | Shared public jobs, errors, radio values, and poster interface. |

## Retry model

Transport failures and HTTP `408`, `429`, and `5xx` responses are retryable.
Malformed packets, invalid ADVERT signatures, and permanent API rejections are
terminal. Missing radio state can be retried because a later `status` message
may supply it.

See the [project README](../../README.md) for configuration and
[`AGENTS.md`](AGENTS.md) for implementation invariants.
