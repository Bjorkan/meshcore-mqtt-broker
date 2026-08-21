# Architecture

The supported deployment is one Docker container, one long-lived Node.js process, one Aedes broker, and one PostgreSQL database. Production connection settings use `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD_FILE`, `DATABASE_SSL`, and `DATABASE_POOL_MAX`; the password is read only from the secret file.

`src/server.ts` binds one plain HTTP server solely to accept MQTT-over-WebSocket upgrades and passes streams to Aedes. It has no HTTP request routes and serves no dashboard, REST API, OpenAPI, MCP, or frontend assets.

Accepted observer publishes are authorized, captured by `src/mqtt-history.ts`, and distributed through Aedes. The PostgreSQL schema separates private runtime data in `meshcore_private` from the typed public node projection in `meshcore_public`. Target forwarding, MeshCore.io upload, node advert recording, CLI, and healthchecks remain local process features.

`postgres/initdb/01-meshcore-bootstrap.sql` provisions roles and verifies the PostGIS and TimescaleDB extensions in `meshcore`; it then executes the complete static schema and projection-trigger asset as `meshcore_owner`. `meshcore_broker` has DML and trigger-function execution grants only. Startup validates the configured PostgreSQL schemas and never creates, drops, resets, or migrates database data.
