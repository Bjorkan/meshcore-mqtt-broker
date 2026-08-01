# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a self-hosting MeshCore network operator. They deploy and configure a regional broker, manage subscriber access and protection policy, monitor network activity and integrations, troubleshoot connectivity and storage, and maintain backups.

Secondary users and actors are:

- MeshCore observers, which authenticate with a public key and signed JWT before publishing regional observations.
- MQTT subscribers, which consume public MeshCore topics through admin, full-access, or limited accounts.
- Members of the public and monitoring integrations, which use the unauthenticated read-only dashboard and JSON API to understand network status.

## Product Purpose

MeshCore MQTT Broker is a self-hosted MQTT endpoint for MeshCore observers, subscribers, and public network monitoring. It authenticates observer identity, enforces region, topic, payload, and subscriber-access policy, persists MQTT and operational state, and exposes accepted public network data through MQTT, a browser dashboard, and a JSON API.

Success means legitimate observers can publish valid regional data, subscribers receive only the data allowed by their roles, durable broker state recovers after restart, optional forwarding integrations expose actionable status, and operators and the public can understand current network health without gaining configuration access.

## Positioning

The product combines a cryptographically authenticated, role-filtered MeshCore MQTT broker with public operational visibility in one compact self-hosted service. Its defining mechanism is a single-container regional broker that validates Ed25519 observer identity and topic ownership while preserving compatibility-sensitive MeshCore observer behavior and adding Swedish region governance, selective target forwarding, and optional verified MeshCore.io advert delivery.

## Operating Context

Operators run one Docker service with a read-only YAML configuration and a persistent host-mounted data directory. They configure the JWT audience, accepted region codes, subscriber accounts, limits, protection behavior, and optional integrations outside the dashboard, then restart the service to apply changes.

Observers connect over MQTT via WebSocket, authenticate as `v1_<PUBLIC_KEY>`, and publish below their allowed `meshcore/<REGION>/<PUBLIC_KEY>/` namespace. The broker validates identity and content before forwarding accepted data to authorized subscribers and optional integrations.

The browser dashboard polls current operational data and supports public inspection of observers, messages, neighbor snapshots, protection events, subscribers, queues, workers, integration health, and map entries. The JSON API supports observer-status lookups. Operators use the `mc-mqtt` CLI for status, observer listing, protection-state cleanup, and explicit application-data reset. Consistent backup requires stopping the container and copying the mounted data directory.

## Capabilities and Constraints

- The supported installation is exactly one Docker container, one Node.js process, one Aedes broker, and one embedded file-backed Turso database. External databases, broker replicas, coordination services, and horizontal scaling are outside the product model.
- Production state is fixed at `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db` and is not configurable. The schema targets clean installations; incompatible databases must fail with clean-directory guidance rather than being migrated.
- Runtime YAML configuration is read-only. The dashboard and API do not modify broker configuration.
- The dashboard and JSON API are unauthenticated, read-only public-monitoring surfaces. HTTP behavior is limited to `GET` and `HEAD`.
- Observers authenticate with Ed25519-signed JWTs. Region, public-key ownership, topic, JSON, payload size, and matching `origin_id` are validated before normal publishes are accepted.
- Subscribers authenticate with passwords and have admin, full-access, or limited roles. Non-admin subscriptions and forwarded data are restricted; limited subscribers receive filtered device and radio details.
- Admin subscribers can use the documented serial command flow. Ordinary subscribers are subscribe-only.
- General client retain flags are removed. Exact `/neighbors` topics are the sole retained exception and expire after 48 hours in MQTT and dashboard/API state.
- Aedes persistence must recover retained packets, persistent subscriptions, offline queues, QoS state, and wills after restart.
- Abuse protection distinguishes denied, muted, and warning-only events. Invalid or unlisted IATA publishes are denied events and do not become abuse mutes by themselves.
- Optional target MQTT forwarding is selective. Optional MeshCore.io delivery accepts validated repeater, room, and sensor adverts through a durable bounded queue.
- Operational histories, cleanup, queries, and in-memory metrics are deliberately bounded. Active sockets, observer ownership, subscriber sessions, and rolling metrics remain process-local.
- Preserve the terms observer, subscriber, region/IATA, public key, `origin_id`, subtopic, neighbors, protection event, target MQTT, MeshCore.io advert, and broker instance ID according to their existing protocol meanings.

## Brand Commitments

The canonical product name is **MeshCore MQTT Broker**. Legacy `Meshat.se` attribution and implementation references do not define the product identity.

Future product, interface, and operational copy should use concise, factual English throughout. Existing Swedish CLI, logging, and configuration text is implementation history rather than the forward language policy.

The product is an operational network service, not a consumer device manager, social product, or emergency-response platform. Future work must not imply those uses without new evidence.

## Evidence on Hand

The repository contains the complete broker, dashboard, JSON API, CLI, configuration example, Docker deployment, architecture and API documentation, automated tests, an inline radio-tower mark, inline interface icons, and an attributed Swedish county lookup dataset.

There are no confirmed testimonials, customer logos, commercial plans, pricing claims, business KPIs, service-level objectives, user-research findings, custom fonts, marketing photography, product illustrations, or seeded demo data. Future work must not fabricate them. Source-level accessibility provisions are present, but there is no documented WCAG conformance claim or completed assistive-technology audit.

## Product Principles

1. Preserve protocol trust: authentication, topic ownership, payload acceptance, subscriber privacy, and compatibility-sensitive MQTT behavior must remain explicit and tested.
2. Keep operations compact: one self-contained service and one durable local database should remain understandable to a self-hosting operator.
3. Make public network state legible without making configuration mutable or exposing private subscriber data.
4. Prefer bounded, recoverable behavior: persistence, queues, histories, cleanup, and failure states must be deterministic and operationally visible.
5. Describe only what the system can prove: use factual English, retain precise MeshCore terminology, and avoid unsupported claims.

## Accessibility & Inclusion

The web dashboard must remain usable across desktop and mobile widths, with semantic structure, keyboard operation, visible focus, text alternatives and status labels, reduced-motion support, and information that does not rely on color alone. Public monitoring views must retain understandable fallback content when enhanced features such as the interactive map are unavailable. These requirements do not constitute a WCAG conformance claim.
