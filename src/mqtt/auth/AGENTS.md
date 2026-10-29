# MQTT authentication instructions

This directory owns observer JWT verification, subscriber credentials and
connection limits, and process-local observer ownership/takeover.

- Observer usernames are `v1_<64-hex-public-key>`. JWT header is exactly
  Ed25519/JWT; claims bind `publicKey` and enforce `iat`, optional `exp`,
  configured audience and clock policy. Preserve stable `AUTH_*` errors.
- Subscriber passwords use constant-time comparison and configured role/count
  limits. Subscriber names cannot shadow the `v1_` namespace.
- The newest observer connection owns a public key. Disconnect from a stale
  connection must never remove the replacement owner's registration.
- Review `jwt.rs`, `ownership.rs`, `subscribers.rs` and `mod.rs` together when
  changing auth flow. Require malformed-token, boundary-time, wrong-key,
  subscriber-limit and takeover tests; do not log tokens or credentials.
