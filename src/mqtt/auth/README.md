# MQTT authentication

This module identifies MQTT clients and maintains the process-local ownership
needed when an observer reconnects or replaces an older session.

## Client types

### Observers

Observers use the username `v1_<64-hex-public-key>` and an Ed25519-signed
JWT-style password. Authentication verifies the key binding, issued-at time,
optional expiry, configured audience, and clock policy.

### Subscribers

Named subscribers are loaded from configuration. Passwords are compared in
constant time, roles are attached to the resulting principal, and each account
has a process-local connection limit.

## Files

| File | Responsibility |
| --- | --- |
| [`mod.rs`](mod.rs) | Exposes `AuthService` and maps usernames to publisher or subscriber principals. |
| [`jwt.rs`](jwt.rs) | Parses and verifies observer tokens and claims. |
| [`subscribers.rs`](subscribers.rs) | Verifies subscriber credentials and tracks connection limits. |
| [`ownership.rs`](ownership.rs) | Records which live connection currently owns each observer public key. |

The newest authenticated observer connection owns its public key. Cleanup from
an older, stale connection cannot erase the replacement owner's registration.

See the parent [MQTT overview](../README.md) and
[`AGENTS.md`](AGENTS.md) for security invariants.
