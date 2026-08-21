# Contributing

Run `npm run check` and `npm test` before opening a pull request. Pull requests and pushes must pass the PostgreSQL functional tests and isolated full-day ingest benchmark CI gate. Do not commit credentials, tokens, private data, local databases, logs, dependencies, or generated `dist/` output.

Keep MQTT authentication, authorization, topic acceptance, subscriber filtering, retained-neighbor behavior, and persistence compatibility covered by tests. Update operational documentation when changing configuration, deployment, or lifecycle behavior.
