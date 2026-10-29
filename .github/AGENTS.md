# Automation instructions

Applies under `.github/`, in addition to root `AGENTS.md`.

- `workflows/build-image-broker.yml` calls reusable Rust CI (`ci.yml`) and the `cargo-deny` dependency-security policy (`dependency-security.yml`). Preserve both as release and PR-image dependencies.
- PR jobs **must not receive registry secrets or publish rights**. Keep tokenless Trivy scanning of the built PR image and authenticated container smoke testing.
- Release only from the trusted `main` branch under existing workflow guards. Preserve AMD64/ARM64 digest scanning, attestations/SBOM, smoke tests and safe final manifest promotion. Do not weaken vulnerability gates to silence CI.
- Pin third-party GitHub Actions by commit SHA. Rust 1.99.0 is pinned by `rust-toolchain.toml`. Keep concurrency, cancellations and job timeouts.
- Keep relevant `pull_request.paths` accurate when Rust sources, tests, workflow definitions, smoke scripts, build settings or agent instructions change. Documentation-only edits may run PR checks but should not publish a new image from `main` solely because docs changed.
- `autofixCI.yml` may format PRs, not push on `main`.
- `scripts/host-smoke.sh` and `scripts/container-smoke.sh` must exercise real binary/container behavior. The container MQTT smoke script should complete MQTT CONNECT/SUBSCRIBE/PUBLISH over negotiated WebSocket, not only HTTP 101.
- Validate YAML, shell and Python scripts where possible. Never commit secrets or real JWTs into `fixtures/`, or print secret values in logs. Check the actual workflow results before claiming CI is green.
