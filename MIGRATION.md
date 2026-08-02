# Migration

This page documents manual configuration and dashboard API compatibility changes for existing deployments. It does not describe database import, schema migration, rollback, or old-database compatibility; those features do not exist.

## Region authorization

`IATA_whitelist` now controls whether `allowed_regions` is enforced. Existing deployments that contain `allowed_regions` retain whitelist enforcement when this setting is absent. To disable their existing allowlist explicitly, add:

```yaml
IATA_whitelist: false
```

The shipped clean-install configuration explicitly disables whitelisting. In that state, publishes accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`.

Move disallowed aliases beneath the allowed primary region. This is a one-time manual configuration change; there is no importer for the removed Swedish county JSON format.

```yaml
allowed_regions:
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
    secondary_region: AGH, KID
```

Existing list entries and object entries containing only `friendly_name` continue to work with the preserved or explicitly enabled whitelist.

Object keys with no value also remain valid primaries:

```yaml
allowed_regions:
  STO:
  MMX:
```

## Meshat deployment branding

The previous Meshat.se dashboard text and website link can be approximated through operator configuration:

```yaml
branding:
  operator_name: Meshat.se
  dashboard_title: Meshat.se MeshCore MQTT Broker
  dashboard_subtitle: Meshat.se operations dashboard
  website_url: https://meshat.se/
```

Transfer any required primary/secondary relationships into `config.yaml`; the broker no longer downloads or reads a separate county data file.

## HTTP fallback

The previous analyzer redirect is not configurable or retained. Ordinary HTTP requests on the MQTT port now redirect to exactly `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.

Configuration validation and configured secondary-region corrections now use neutral English text. Other established fork-local operator/runtime wording is unchanged.

## Dashboard API

Use `regionLookup` instead of `countyLookup` in `/api/dashboard`. The deprecated `countyLookup` alias remains in the current release and will only be removed in a documented breaking release.
