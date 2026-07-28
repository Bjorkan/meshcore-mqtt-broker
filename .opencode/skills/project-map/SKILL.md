---
name: project-map
description: Locate the MeshCore MQTT broker's runtime, dashboard, persistence, tests, scripts, workflows, and documentation, and choose the correct files and checks for a change.
compatibility: opencode
metadata:
  project: meshcore-mqtt-broker
  audience: maintainers
---

# Project map

## Instructions to read

Always read `AGENTS.md`, then the nearest nested instruction file for every path involved:

- `src/AGENTS.md`
- `dashboard/AGENTS.md`
- `tests/AGENTS.md`
- `scripts/AGENTS.md`
- `.github/workflows/AGENTS.md`

Also read the relevant project documentation:

- `ARCHITECTURE.md` — runtime, schema, ownership, lifecycle, and operations.
- `README.md` — installation and user-visible behavior.
- `API_DEVELOPMENT.md` — dashboard/public API contracts.

## Runtime entry points

- `src/server.ts` — broker creation, listeners, auth wiring, ownership, shutdown.
- `src/config.ts` — read-only YAML configuration and validation.
- `src/dashboard.ts` — dashboard snapshot and public observer API.
- `src/cli.ts` — fixed-database operational CLI.
- `src/healthcheck.ts`, `src/healthcheck-loopback.ts`, `src/docker-health-user.ts` — real health behavior.
- `src/target-bridge.ts` — optional target broker forwarding.
- `src/meshcore-io-runtime.ts`, `src/meshcore-io-poster.ts`, `src/meshcore-io-utils.ts` — MeshCore.io ingress, queue, upload, and map state.

## MQTT and protection

- `src/abuse-detector.ts`
- `src/rate-limiter.ts`
- `src/neighbors.ts`
- `src/orphaned-will.ts`
- `src/ip-utils.ts`
- compatibility-sensitive sections of `src/server.ts`

## Persistence

- `src/database.ts` — fixed path, connection, schema, validation, health probe.
- `src/aedes-persistence-turso.ts` — Aedes persistence contract.
- `src/state-store.ts` — relational observer/trust/dashboard state and process-local sessions.

## Dashboard

- `dashboard/src/app.tsx` — application composition and data lifecycle.
- `dashboard/src/theme.ts` — Material Design 2 theme and component overrides.
- `dashboard/src/components/layout/` — drawer and app bar.
- `dashboard/src/components/shared/` — tables, metrics, empty and status primitives.
- `dashboard/src/components/details/` — detail dialogs.
- `dashboard/src/views/` — overview, observers, bans, subscribers, MeshCore.io.
- `dashboard/src/api.ts`, `types.ts`, `router.ts`, `helpers/` — data, routing, formatting.
- `scripts/seed-dashboard-demo.mjs` and `scripts/capture-dashboard-screenshots.mjs` — visual fixtures and captures.

## Tests

Tests are in `tests/*.test.mjs` and generally mirror source modules. Search for the target symbol and observable behavior, not only the filename. Use `tests/test-database.mjs` for isolated database setup.

## Build and delivery

- `package.json` — authoritative scripts.
- `tsconfig.json` and `dashboard/tsconfig.json` — TypeScript targets.
- `vite.config.ts` — dashboard build and API proxy.
- `eslint.config.mjs`, `.prettierrc` — style gates.
- `Dockerfile`, `docker-entrypoint.sh`, `compose.yaml.example` — supported container installation.
- `.github/workflows/` — build, image, autofix, and dashboard screenshots.

## Impact procedure

1. Find all reads, writes, callers, and tests for the changed state or symbol.
2. Identify every applicable `AGENTS.md` file.
3. Identify whether the change touches MQTT compatibility, durable state, lifecycle, UI/API shape, tests, scripts, or deployment.
4. Load the matching domain skill.
5. List documentation that must stay synchronized.
6. Select targeted and full verification commands from the `verification` skill.

## Model-aware exploration

DeepSeek V4 Pro is text-only. Treat image and screenshot files as opaque. For dashboard investigation, locate source, Playwright harnesses, DOM assertions, computed-style/geometry checks, console output, and human-review artifact paths rather than claiming visual inspection.
