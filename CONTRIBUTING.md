# Contributing

Run `bun run check` (format + lint + typecheck) and `bun test` before opening a pull request. Development and CI require Bun 1.4.0 (`bun install --frozen-lockfile`); npm is not used. Pull requests and pushes must pass the stateless suite (see `.github/workflows/ci.yml`). Do not commit credentials, tokens, private data, local databases, logs, dependencies, or output artifacts.

Keep MQTT authentication, authorization, topic acceptance, observer error codes, subscriber filtering, and retained-neighbor behavior covered by tests. Update operational documentation when changing configuration, deployment, or lifecycle behavior.
