# Configuration

This module turns the deployment's read-only YAML file and `MESHCORE_*`
environment overrides into the validated runtime [`Config`](types.rs) used by
the broker.

## Data flow

```text
config.yaml → YAML document → environment overrides → validation → Config
```

Configuration discovery checks `MESHCORE_CONFIG` first, then the supported
working-directory and container paths. The source file is never modified.
Legacy deployed aliases remain accepted and are normalized before the rest of
the application sees them.

## Files

| File | Responsibility |
| --- | --- |
| [`mod.rs`](mod.rs) | Discovers and loads configuration, then assembles the validated result. |
| [`document.rs`](document.rs) | Serde input schema, defaults, and legacy YAML aliases. |
| [`environment.rs`](environment.rs) | Typed `MESHCORE_*` environment overrides. |
| [`iata.rs`](iata.rs) | IATA normalization and friendly-name validation. |
| [`validation.rs`](validation.rs) | Listener, URL, range, TLS, and integration validation. |
| [`types.rs`](types.rs) | Runtime configuration types and secret-redacted `Debug` output. |

## Important behavior

- Environment variables take precedence over YAML.
- Missing or whitespace-only environment values do not override YAML values.
- Invalid values fail startup with a typed configuration error.
- Subscriber passwords, Target MQTT credentials, and MeshCore.io signing keys
  are never included in debug output.

See the [project README](../../README.md) for deployment options and
[`AGENTS.md`](AGENTS.md) for maintenance invariants.
