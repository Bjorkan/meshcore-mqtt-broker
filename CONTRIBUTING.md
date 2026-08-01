# Contributing

## Development

Use the Node.js version in `.node-version`.

```bash
npm ci
npm run check:lockfile
npm run format:check
npm run lint
npm run build
npm run test:ci
```

Tests import built modules from `dist/`; do not edit generated output manually. Keep the one-container, one-process, one-Aedes, embedded-Turso architecture and fixed production database path.

## Changes

Create a focused branch, add tests for behavior changes, and update `README.md`, `CONFIGURATION.md`, `API_DEVELOPMENT.md`, or `ARCHITECTURE.md` when their contracts change. Preserve authentication, topic/payload acceptance, subscriber role, private-topic filtering, target forwarding, and retained-neighbor compatibility unless the pull request explicitly explains and tests an intentional difference.

Do not commit credentials, tokens, private data, local databases, logs, `.env` files, `.opencode/`, dependencies, or generated release archives.

## Pull requests

Open pull requests against the repository's default branch. Describe the user-visible effect, compatibility impact, tests run, and any deployment or migration action. Image publication occurs only after reviewed changes reach the guarded default branch; pull-request builds do not publish images.
