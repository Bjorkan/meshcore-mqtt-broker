# Configuration module instructions

This directory parses the read-only YAML document, applies `MESHCORE_*`
overrides and builds the validated runtime configuration. Follow
`src/AGENTS.md` as well.

- `document.rs` owns Serde shapes, defaults and deployed legacy aliases.
  Preserve `allowed_regions`, `IATA_whitelist`, `secondary_region`,
  `maxConnections` and numeric-string compatibility unless migration is
  explicitly approved.
- Environment values override YAML. Missing or whitespace-only variables do
  not override file values; malformed booleans and numbers must be explicit
  configuration errors.
- `validation.rs` owns listener/URL/range checks and mandatory outbound TLS
  verification. Raw legacy options that are always denied belong in
  `document.rs`, not in validated runtime types.
- `iata.rs` owns primary/secondary IATA normalization and friendly-name
  validation. Do not reinterpret geographic IATA codes as MeshCore scopes.
- `types.rs` owns runtime settings and redacted `Debug`. Never expose target
  credentials, subscriber passwords or MeshCore.io private keys in errors or
  logs.
- Update config unit tests and `tests/fixtures/` together for schema changes.
  Test YAML, environment precedence, invalid input and secret redaction. Do
  not write back to the mounted configuration or add dynamic reload state.
