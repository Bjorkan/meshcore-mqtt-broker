---
name: verification
description: Select and run the repository's targeted and full formatting, lint, TypeScript, Vite, Jest, lockfile, Docker, and dashboard screenshot checks, then diagnose failures accurately.
compatibility: opencode
metadata:
  domain: quality
  runner: npm
---

# Verification workflow

Use scripts already defined in `package.json`.

## Baseline environment

```bash
node --version
npm --version
git status --short
```

The repository has a `.node-version`; report a mismatch rather than silently ignoring engine-related failures.

## Fast targeted checks

Choose the smallest relevant test file first:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/<name>.test.mjs
```

Useful mappings include:

- configuration → `tests/config.test.mjs`
- database/schema → `tests/database.test.mjs`
- Aedes persistence → `tests/aedes-persistence-turso.test.mjs`
- state → `tests/state-store.test.mjs`
- runtime/server contracts → `tests/runtime-local.test.mjs`
- neighbors → `tests/neighbors.test.mjs`
- abuse/rate limits → `tests/abuse-detector.test.mjs`, `tests/rate-limiter.test.mjs`
- target bridge → `tests/target-bridge.test.mjs`
- MeshCore.io → `tests/meshcore-io-local.test.mjs`
- dashboard helpers/bundle → `tests/dashboard-helpers.test.mjs`
- health → `tests/healthcheck-local.test.mjs`
- package contract → `tests/package-local-contract.test.mjs`

Search for current names before assuming a mapping is complete.

## Standard gates

```bash
npm run check:lockfile
npm run format:check
npm run lint
npm run build
npm test
```

`npm run check` covers lockfile portability, formatting, lint, and build. `npm run test:ci` is the strict CI test invocation with diagnostics.

## Dashboard checks

```bash
npm run build:dashboard
npm run dashboard:seed-demo
npm run dashboard:screenshots
```

The screenshot workflow may require the application, browser dependencies, and seeded demo data. Diagnose environment failures separately from UI regressions. DeepSeek V4 Pro cannot visually inspect the output: pair captures with browser assertions for DOM state, accessibility, element geometry, overflow, focus/keyboard behavior, console errors, and computed styles. Record screenshot paths for human review; capture success alone is not a UI pass.

## Container checks

Where Docker is available:

```bash
docker build --pull --tag meshcore-mqtt-broker:local .
docker compose -f compose.yaml.example config
```

Do not push images.

## Failure handling

- Capture the first meaningful failure, but continue independent checks when useful.
- Distinguish dependency/network/environment failures from code failures.
- Do not modify lockfiles or generated output merely to suppress a failing check.
- After a fix, rerun the failing command and the nearest broader gate.
- Report exact commands and results. Never summarize an unrun command as passed.
