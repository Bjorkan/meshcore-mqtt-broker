# Contributing

Run `bun run check` and `bun test` (the PostgreSQL suite) before opening a pull request. Development and CI require Bun 1.4.0 (`bun install --frozen-lockfile`); npm is not used. Pull requests and pushes must pass the PostgreSQL functional tests and isolated full-day ingest benchmark CI gate. Do not commit credentials, tokens, private data, local databases, logs, dependencies, or output artifacts.

Keep MQTT authentication, authorization, topic acceptance, subscriber filtering, retained-neighbor behavior, and persistence compatibility covered by tests. Update operational documentation when changing configuration, deployment, or lifecycle behavior.
