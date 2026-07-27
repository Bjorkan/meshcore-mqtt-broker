# GitHub Actions workflow instructions

These instructions apply to `.github/workflows/`. Read the root `AGENTS.md` first.

## Workflow principles

- Keep permissions least-privilege and job-scoped where possible.
- Pin third-party actions to immutable commit SHAs and retain the version comment.
- Use `.node-version`, `package-lock.json`, and existing package scripts; do not duplicate build, lint, formatting, or test logic in YAML.
- Validate lockfile portability before `npm ci`.
- Keep pull-request workflows safe for untrusted contributions. Never expose publish credentials or write-capable tokens to code from an untrusted fork.
- Do not print secrets, full credentials, JWTs, or sensitive environment values.
- Add `timeout-minutes` to jobs or steps that can hang and ensure background processes are cleaned up.
- Upload diagnostic artifacts on failure only when useful, with bounded retention and no secrets.
- Preserve reproducible `linux/amd64` and `linux/arm64` image builds and the supported single-container runtime.
- Do not add Swarm deployment, replicas, an external database, or production deployment side effects to pull-request validation.

## Existing workflow responsibilities

- `build-image-broker.yml`: lockfile, dependency install, format/lint, build/tests, Compose validation, local image build/security scan, and main-branch publication.
- `dashboard-screenshots.yml`: deterministic live broker setup, demo database, Chromium capture, artifact upload, and PR report. The workflow must expose machine-checkable browser failures; screenshot artifacts are for human review because the configured DeepSeek V4 Pro agent has no vision capability.
- `autofixCI.yml`: formatting and ESLint autofix only; it must not make semantic feature changes.

When source paths or build inputs change, update workflow path filters so required checks still run. Avoid path filters that accidentally skip compatibility, Docker, dashboard, script, or test changes.

## Publishing safety

Publishing must remain restricted to trusted `push` events on `main`, after required tests and image build checks. Do not publish from pull requests. Keep registry logins scoped to the publish job and use repository secrets/variables rather than literals.

## Verification

At minimum:

```bash
npm run check:lockfile
npm run format:check
npm run lint
npm run test:ci
docker compose -f compose.yaml.example config --quiet
docker build --pull --tag meshcore-mqtt-broker:local .
```

Also inspect YAML expressions, permissions, path filters, action inputs, artifact paths, and event conditions. Do not push images or trigger releases during local validation.
