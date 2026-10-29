# MeshCore.io module instructions

This directory owns validated MQTT ingress, firmware ADVERT decoding, radio
state, signing, HTTP upload classification, bounded queues, workers and their
shutdown. Follow `src/AGENTS.md` as well.

- `signing.rs` and `poster.rs` preserve the exact signed JSON fields `data`,
  `signature` and `publicKey`. Never log configured private key material.
- Observer `status` supplies radio parameters used by later `packets` ADVERT
  ingress. Missing/late radio state is retryable; malformed bytes and invalid
  signatures are terminal.
- `ingress.rs`, `advert.rs` and `radio.rs` must be reviewed together when a
  firmware format changes. Keep legacy comma-separated and labelled radio
  forms covered by tests.
- `queue.rs` and `runtime.rs` own process-local dedup, cooldown, capacity,
  retry/backoff, counters and worker lifecycle. Queue admission is not upload
  completion. Shutdown must stop admission, cancel in-flight HTTP and join all
  owned tasks.
- HTTP 408/429/5xx and transport failures retry; permanent client/API
  rejections complete without retry. Parse and classify a response once in
  `poster.rs`; queue code must not infer outcomes from response text.
- Changes require focused parser/signing/queue tests plus the full
  `meshcore_io` unit suite. Do not add persistence, unbounded queues, detached
  tasks, speculative traits or extra worker processes.
