# Product

MeshCore MQTT Broker is a self-hosted MQTT-over-WebSocket endpoint for MeshCore observers and subscribers. It authenticates observers, enforces topic and geographic IATA ingress policy, filters subscriber access, and persists accepted MQTT state locally. IATA is separate from MeshCore logical regions, which are represented by neighbor scopes.

The supported installation is one Compose broker container, one Node.js process, one Aedes broker, and the locally deployed MeshDB PostgreSQL database. The broker has no dashboard, REST API, OpenAPI, MCP, or browser frontend surface. Operators configure it through read-only YAML and use the CLI for local operational actions.
