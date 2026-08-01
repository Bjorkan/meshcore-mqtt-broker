# Migration

## Region authorization

`IATA_whitelist` now defaults to `false`. Existing deployments that relied on `allowed_regions` for authorization must add:

```yaml
IATA_whitelist: true
```

Without it, `allowed_regions` is inactive and every valid three-letter region is accepted.

Move disallowed aliases beneath the allowed primary region. This is a one-time manual configuration change; there is no importer for the removed Swedish county JSON format.

```yaml
allowed_regions:
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
    secondary_region: AGH, KID
```

Existing list entries and object entries containing only `friendly_name` continue to work after explicitly enabling the whitelist.

Object keys with no value also remain valid primaries:

```yaml
allowed_regions:
  STO:
  MMX:
```

## Meshat deployment branding

The previous Meshat.se presentation can be restored entirely through operator configuration:

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

Use `regionLookup` instead of `countyLookup` in `/api/dashboard`. The deprecated `countyLookup` alias remains for one release and will then be removed.
