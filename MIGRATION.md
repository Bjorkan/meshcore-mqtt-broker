# Migration

This page documents manual deployment, configuration, and HTTP API compatibility changes for existing installations. It does not describe database import, schema migration, rollback, or old-database compatibility; those features do not exist.

## Nodes API schema

The nodes API adds the `heard_node_adverts` and `heard_node_regions` tables to the clean-install schema. A database created by an earlier build is intentionally incompatible. Stop the container, preserve the old bind-mounted directory as a backup if needed, and start this build with an empty data directory. There is no in-place schema migration or advert-history import.

The broker records verified signed adverts from accepted MQTT `raw` and `packets` publishes even when MeshCore.io is disabled. It retains one latest advert copy per node and one independently expiring last-heard row per `(node, region)`. Both use a rolling seven-day lifetime. A valid older advert can refresh where the node was heard without replacing a newer retained advert.

The new public routes are:

- `/api/v1/nodes` for all recently heard nodes;
- `/api/v1/nodes?region=ABC` for any active hearing in an MQTT/IATA region;
- `/api/v1/nodes?region=SWE` for latest advert coordinates inside Sweden;
- `/api/openapi.json` for the OpenAPI 3.1 contract;
- `/api/docs` for the locally served Swagger UI.

Node objects expose `regions` and `regionHearings`; there is no single authoritative observer region. Clients must not infer that the first region is the only place a node was heard. `advertTimestamp` is in Unix seconds; `advertHeardAt`, node-wide `heardAt`/`expiresAt`, and each region hearing time are Unix milliseconds.

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

The dashboard and API are now separate request handlers. They still share the existing `mqtt.host`/`dashboard.port` HTTP listener, so Compose ports and reverse-proxy destinations do not change. The browser dashboard reads `/api/dashboard` as an API client; custom integrations should use the documented `/api/*` routes rather than dashboard static assets.

All dashboard/API routes remain unauthenticated and read-only. The nodes API additionally exposes verified raw advert packets, node public keys, observer public keys, coordinates when present, and per-region hearing times. Review network or reverse-proxy access controls before deploying the updated image.
