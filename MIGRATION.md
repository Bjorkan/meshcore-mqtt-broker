# Migration Notes

This release removes the broker-owned dashboard, REST API, OpenAPI document, Swagger UI, MCP endpoint, and frontend assets. Only MQTT over WebSocket remains on `mqtt.host` and `mqtt.ws_port`.

The deprecated MQTT `/raw` subtopic is discarded before delivery, forwarding, storage, or processing. Publishers must place raw MeshCore bytes in `/packets` JSON instead.

The public reader contract now includes schema metadata, keyset-pagination indexes, relational neighbor-scope tables, PostGIS node/advert locations, region-leading hearing indexes for IATA-region filtering, and the public `node_prefix_candidates` projection for route-hop ambiguity reconstruction. Existing deployments must be reprovisioned according to the clean-install schema lifecycle (schema version 5) before a read-only HTTP/MCP process uses these fields.

Remove `branding`, `mcp`, and `public_tool_api` configuration sections. Clients using HTTP routes must move to MQTT or an external service. The embedded database remains a clean-install schema: incompatible databases are deleted at broker startup and recreated without migration.
