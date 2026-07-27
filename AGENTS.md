# Repository instructions

## Project overview

This repository is a fork of `michaelhart/meshcore-mqtt-broker`. It provides a single-container MeshCore MQTT broker with a Node.js/Aedes runtime, an embedded file-backed Turso database, a React/Vite/Material UI dashboard, and optional target-broker and MeshCore.io integrations.

Instructions are cumulative. Read this file first, then the nearest nested `AGENTS.md` for the files being changed. When instructions overlap, the nearest file supplies the more specific rule.

| Area | Additional instructions |
| --- | --- |
| Server runtime, MQTT, API, database | `src/AGENTS.md` |
| React/Vite dashboard | `dashboard/AGENTS.md` |
| Jest and integration tests | `tests/AGENTS.md` |
| Development and screenshot scripts | `scripts/AGENTS.md` |
| GitHub Actions workflows | `.github/workflows/AGENTS.md` |


## Model capability and evidence rules

OpenCode is configured for `opencode-go/deepseek-v4-pro`. DeepSeek V4 Pro is a text-only model with strong coding, reasoning, long-context, and tool-calling capability. It has no native vision capability.

Treat image files and screenshot attachments as opaque unless an available tool returns textual or numerical evidence about them. In particular:

- never claim to have visually inspected or compared screenshots,
- never infer a visual defect from a filename or successful screenshot capture,
- do not describe colors, spacing, alignment, clipping, or visual hierarchy without source, DOM, computed-style, browser-geometry, accessibility, or image-analysis tool evidence,
- distinguish machine-verified UI facts from subjective appearance that still needs human or separately configured vision-capable review,
- remember that the Material UI MCP supplies documentation and examples only; it does not provide vision.

For UI work, use source review plus objective browser evidence: DOM and accessibility state, computed styles, element bounds, viewport intersections, overflow checks, minimum target sizes, keyboard navigation, console/page errors, contrast calculations, and deterministic screenshot diffs when a reviewed baseline already exists. Generated screenshots are artifacts for human review, not evidence that the model inspected their contents.

## Architecture contract

The supported production topology is exactly:

- one Docker container,
- one Node.js process,
- one Aedes broker and local emitter,
- one embedded file-backed Turso database.

Do not add an external database, cloud state, coordination service, broker replica, election, lease, distributed worker, Docker Swarm mode, or horizontal-scaling abstraction.

Production storage is fixed in `src/database.ts`:

```text
/data/meshcore-mqtt-broker/
/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db
```

Do not expose the database path through configuration, environment variables, Docker settings, or CLI options. Tests may use only the explicit test database factory/dependency.

This is a clean-install schema. Do not add migration files, runners, schema versions, rollback logic, legacy imports, old-schema compatibility, or ORM synchronization. Keep the direct idempotent current-schema initializer. Incompatible databases must fail with clean-directory instructions.

## Compatibility contract

Preserve the upstream MQTT observer contract unless an intentional fork decision in `src/AGENTS.md` says otherwise. Authentication, topic and payload acceptance, subscriber roles, reserved namespaces, serial flow, abuse enforcement, target forwarding, observer ownership, and retained-neighbor behavior are compatibility-sensitive.

Before changing a compatibility-sensitive path:

1. trace both accepted and rejected flows,
2. inspect existing tests,
3. compare upstream behavior when the intended behavior is unclear,
4. add regression tests for every intentional difference.

## Development workflow

- Inspect `git status --short` and the relevant diff before and after edits when Git metadata exists.
- Preserve unrelated worktree changes.
- Do not stage, commit, amend, reset, clean, rebase, push, publish, or create releases unless the user explicitly requests that exact action.
- Read the implementation, callers, tests, and documentation before designing a change.
- Prefer a small explicit solution over speculative abstractions.
- Keep queues, retries, queries, payloads, timers, and cleanup bounded.
- Update documentation when installation, configuration, API, architecture, schema, security, lifecycle, or compatibility changes.
- Report only checks that were actually run; distinguish passed, failed, unavailable, and skipped checks.

## Build and verification

Use the existing package scripts rather than creating parallel commands:

```bash
npm run check:lockfile
npm run format:check
npm run lint
npm run build
npm test
```

Useful focused commands:

```bash
npm run build:server
npm run build:dashboard
npm run test:ci
npm run dashboard:seed-demo
npm run dashboard:screenshots

docker build --pull --tag meshcore-mqtt-broker:local .
docker compose -f compose.yaml.example config
```

Start with the smallest relevant test, then run broader checks. A compile-only result is not sufficient evidence for behavior changes.

## Code style

- TypeScript ESM; preserve the dashboard ES2020 target.
- Prefer explicit types and narrow validation over `any`, broad casts, or disabled lint rules.
- Use deterministic ordering, bound SQL parameters, explicit transactions, and idempotent cleanup.
- Avoid hidden global state, duplicate timers, unowned background work, arbitrary sleeps, broad catches, and weakened assertions.
- Use the repository Prettier and ESLint configuration.

## Security

Treat external MQTT/WebSocket traffic, HTTP requests, proxy headers, JWT/public-key identity, topic ownership, `origin_id`, SQL inputs, forwarded payloads, and logs as trust boundaries. Preserve payload and queue limits, subscriber isolation, reserved namespaces, secret redaction, and bounded error output.

## Documentation index

| Area | File |
| --- | --- |
| User installation, configuration, API, CLI | `README.md` |
| Runtime, schema, lifecycle, deployment | `ARCHITECTURE.md` |
| Dashboard/public API development | `API_DEVELOPMENT.md` |
| Historical Vite/MUI migration notes | `MIGRATION_VITE_MATERIAL_UI.md` |
| Current visual audit record | `UI_AUDIT.md` |
