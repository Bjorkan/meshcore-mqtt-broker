# Contributing

## Development

Use the Node.js version in `.node-version`.

```bash
npm ci
npm run check:lockfile
npm run format:check
npm run lint
npm run test:ci
docker compose -f compose.yaml.example config --quiet
```

`npm run test:ci` performs a clean build before running tests. Tests import built modules from `dist/`; do not edit generated output manually. Keep the one-container, one long-lived broker process, one-Aedes, embedded-Turso architecture and fixed production database path. Short-lived healthcheck and CLI processes are allowed but must not host broker or worker replicas.

HTTP integration tests bind temporary loopback ports but use no external service. Dashboard screenshot generation is a separate Playwright workflow (`npm run dashboard:screenshots`) and may require browser dependencies; ordinary unit/integration tests do not download map tiles or call MeshCore.io.

## Changes

Create a focused branch and add tests for behavior changes. Preserve authentication, topic/payload acceptance, subscriber role, private-topic filtering, target forwarding, and retained-neighbor compatibility unless the pull request explicitly explains and tests an intentional difference.

Keep documentation synchronized by responsibility:

- `README.md`: installation, connection behavior, dashboard/API, CLI, backup, and upgrade actions;
- `CONFIGURATION.md`: every consumed YAML setting, default, validation rule, and source-defined non-setting;
- `API_DEVELOPMENT.md` and `OPENAPI_DOCUMENT` in `src/api.ts`: every route, parameter, status, and public response field;
- `ARCHITECTURE.md`: runtime topology, modules, schema, persistence, lifecycle, and durable/process-local boundaries;
- `MIGRATION.md`: manual deployment, schema, configuration, and API compatibility actions;
- `PRODUCT.md`: supported users, product scope, capabilities, constraints, and evidence;
- `DESIGN.md`: implemented dashboard tokens, layout, components, accessibility behavior, and explicit scope;
- `SECURITY.md`: reporting and deployment/data-exposure risks;
- `THIRD_PARTY_NOTICES.md`: bundled data, assets, services, libraries, licenses, and local modifications;
- `AGENTS.md`: repository invariants and documentation/source index.

The database is a clean-install schema. Change the direct idempotent initializer and exact schema validation together; do not add migrations, compatibility shims, schema versions, or import/rollback machinery. Document that existing databases become incompatible whenever the fingerprint changes.

Do not commit credentials, tokens, private data, local databases, logs, `.env` files, `.opencode/`, dependencies, generated `dist/` output, dashboard screenshots, or release archives. Bundled data/assets require an appropriate entry in `THIRD_PARTY_NOTICES.md` and any required license text under `LICENSES/`.

## Pull requests

Open pull requests against the repository's default branch. Describe the user-visible effect, compatibility impact, tests run, data/license changes, and any deployment or clean-install action. API changes must call out authentication/exposure effects and include the updated OpenAPI contract. Image publication occurs only after reviewed changes reach the guarded default branch; pull-request builds do not publish images.
