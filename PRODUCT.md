# Product

MeshCore MQTT Broker is a self-hosted, stateless MQTT-over-WebSocket endpoint for MeshCore observers and subscribers. It authenticates observers, enforces topic and geographic IATA ingress policy with machine-readable error codes, filters subscriber access, and routes accepted MQTT state in process memory. IATA is separate from MeshCore logical regions, which are represented by neighbor scopes.

The supported installation is one Compose broker container, one Bun process, and one Aedes broker, behind Traefik/CrowdSec for TLS and IP blocking. The broker has no dashboard, REST API, OpenAPI, MCP, browser frontend surface, or database. Operators configure it through read-only YAML and use `GET /status` for live operational status. The runtime is limited to MQTT routing, target forwarding, and optional MeshCore.io uploading, with the health endpoint supporting container operations.
