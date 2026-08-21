# Migration Notes

This release removes the broker-owned dashboard, REST API, OpenAPI document, Swagger UI, MCP endpoint, and frontend assets. Only MQTT over WebSocket remains on `mqtt.host` and `mqtt.ws_port`.

Remove `branding`, `mcp`, and `public_tool_api` configuration sections. Clients using HTTP routes must move to MQTT or an external service. The embedded database remains a clean-install schema: incompatible databases are deleted at broker startup and recreated without migration.
