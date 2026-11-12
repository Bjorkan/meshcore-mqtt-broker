# MeshCore MQTT Broker

**A lightweight MQTT bridge for MeshCore observers and the apps that listen to them.**

MeshCore MQTT Broker receives information from MeshCore observer devices and makes it available to authorized MQTT clients. Use it to collect device status, packets, and neighbor information in one place, or to forward selected data to another MQTT broker.

**Powering Meshat.se:** This repository is the codebase behind **Meshat.se MeshCore MQTT**, the service hosted at [`meshcore-mqtt.meshat.se`](https://meshcore-mqtt.meshat.se). The same broker can also be self-hosted for your own MeshCore setup.

You can run it on a server, a small home lab, or a Docker host. No database is required.

## What can I do with it?

- **Receive MeshCore data:** accept status updates, packets, and neighbor information from authenticated observers.
- **Connect your own tools:** read public MeshCore topics with a standard MQTT client that supports **MQTT over WebSocket**.
- **Control access:** give readers limited or full access, or create an administrator account.
- **Forward selected messages:** optionally send status, packets, and neighbors to another MQTT broker.
- **Share verified node adverts:** optionally upload eligible repeater, room, and sensor adverts to MeshCore.io.
- **Check that it is running:** use the built-in `/status` endpoint and Docker healthcheck.

### How it fits together

```text
MeshCore observer(s)
        |
        | MQTT over WebSocket (authenticated)
        v
+-------------------------+
|  MeshCore MQTT Broker   |
|                         |
|  - access control       |
|  - live MQTT messages   |
|  - in-memory retention  |
+-------------------------+
        |             |
        |             +--> Optional: other MQTT broker / MeshCore.io
        v
MQTT subscribers
(dashboards, tools, monitoring)
```

**Good to know:** This is a broker service, not a MeshCore firmware replacement or a graphical dashboard. To see live MeshCore telemetry, you need an observer that is configured to publish to it.

## Quick start with Docker Compose

This is the easiest way to try the broker locally. You will need **Docker with Docker Compose** and a copy of this repository.

### 1. Download the project

Either download and extract the [repository ZIP](https://github.com/Bjorkan/meshcore-mqtt-broker/archive/refs/heads/main.zip), or use Git:

```bash
git clone https://github.com/Bjorkan/meshcore-mqtt-broker.git
cd meshcore-mqtt-broker
```

If you downloaded the ZIP instead, open a terminal in the extracted project folder.

### 2. Set up your configuration

Open **`config.yaml`** in a text editor. The repository includes a starting configuration, including a list of allowed Swedish IATA area codes.

For a first test, add a read-only subscriber account by replacing the existing `subscribers:` section with:

```yaml
subscribers:
  default_max_connections: 2
  users:
    - username: viewer
      password: "replace-this-with-a-long-unique-password"
      role: 3
```

Change the sample password before starting the broker. The roles are explained [below](#subscriber-access-levels).

If you are connecting an actual MeshCore observer, also set `auth.expected_audience` to the audience expected by that observer's authentication token. The included `mqtt.yourdomain.com` value is only a placeholder. The `auth.expected_audience` setting must be present.

### 3. Prepare Docker Compose

Make a local copy of the supplied example:

```bash
cp compose.yaml.example compose.yaml
```

The example publishes the broker on **`127.0.0.1:443`**, but the broker itself does **not** provide HTTPS or TLS. For a clearer and safer local test, change the `ports:` section in `compose.yaml` to:

```yaml
ports:
  - "127.0.0.1:8883:8883"
```

This makes the service accessible **from the Docker host only**, using plain HTTP/WebSocket. Do not expose this unencrypted endpoint directly to the internet.

### 4. Start the broker

```bash
docker compose up -d
```

Docker Compose uses the published `bjorkan/meshcore-mqtt-broker:latest` image specified in the example file. If you prefer to build from the source you downloaded, change the service's `image:` line to a local image name and add `build: .`, then run `docker compose up -d --build`.

Check that the container is running:

```bash
docker compose ps
docker compose logs --tail=50
```

Then open <http://127.0.0.1:8883/status> or run:

```bash
curl http://127.0.0.1:8883/status
```

You should receive JSON containing `"status": "ok"` and `"storage": "stateless"`.

> [!NOTE]
> A healthy broker means the service is running. It does **not** mean a MeshCore observer has connected or started sending data yet.

## Connect an MQTT client

Any client supporting **MQTT 3.1.1 or MQTT 5 over WebSocket** can connect. For example, use an MQTT desktop client such as [MQTTX](https://mqttx.app/).

For the **local Docker setup above**, use:

| Setting | Value |
| --- | --- |
| Connection type | MQTT over **WebSocket** (`ws`) |
| Host | `127.0.0.1` |
| Port | `8883` |
| WebSocket path | `/mqtt` (also supports `/`) |
| Username | `viewer` |
| Password | The password you set in `config.yaml` |
| MQTT version | 3.1.1 or 5 |
| TLS / SSL | **Off** for this local test |

After connecting, subscribe to:

| Topic | What you get |
| --- | --- |
| `heartbeat/` | Periodic broker heartbeat (normally every 30 seconds) |
| `meshcore/#` | Public MeshCore messages available to your account |
| `meshcore/JKG/#` | Public messages for the JKG area, if they are being published |

You can also subscribe to an individual device topic. The normal topic structure is:

```text
meshcore/<IATA>/<64-character-public-key>/<subtopic>
```

Common subtopics include `status`, `packets`, and `neighbors`.

**Important:** A normal TCP-only MQTT connection will not work. This broker's client-facing listener supports **MQTT over WebSocket**, not ordinary MQTT over TCP. Port `8883` is just the default port number here; **it does not mean TLS is enabled**.

### Subscriber access levels

Each subscriber account is configured in `config.yaml`:

| Role | Value | Intended use |
| --- | --- | --- |
| **LIMITED** | `3` | Read public messages with certain detailed fields removed |
| **FULL_ACCESS** | `2` | Read public messages with their full payloads |
| **ADMIN** | `1` | Administration and private-topic access, including sending serial commands |

For most dashboards and monitoring clients, start with **LIMITED (`3`)**. Subscriber accounts are read-only unless they have the administrator role. Administrators should be trusted and used sparingly.

MeshCore **observers** use a different sign-in method: a username in the form `v1_<64-character-public-key>` and a signed MeshCore token as the password. They must publish under their own public key and an allowed IATA area code. These credentials are supplied by the observer's configuration; they are **not** created as ordinary `subscribers.users` accounts.

## Configuration you are most likely to change

The complete configuration template is [config.yaml](config.yaml). These are the most relevant options:

| Setting | Purpose |
| --- | --- |
| `mqtt.host` / `mqtt.ws_port` | Local address and port on which the broker listens |
| `auth.expected_audience` | Audience validation for observer authentication; required even when intentionally set to `""` |
| `subscribers.users` | Accounts used by dashboards, tools, and other MQTT readers |
| `subscribers.default_max_connections` | Default simultaneous-connection limit per subscriber |
| `allowed_iata` | Geographic codes from which observers may publish |
| `iata.allowlist_enabled` | Whether the IATA allowlist is enforced |
| `mqtt.trusted_proxies` | Which reverse proxies may supply the original client IP |
| `target_mqtt.url` | Optional forwarding destination |
| `meshcore_io.enabled` | Opt in to MeshCore.io advert uploads |

**IATA codes:** These are geographic ingress identifiers, not MQTT account names. The provided config includes Swedish regions and their primary/secondary codes. An observer must use an allowed **primary** code; for example, JKG identifies Jönköping and the southern Lake Vättern area. Update the allowlist for your own deployment.

**Environment variables:** Settings can also be overridden using the `MESHCORE_` prefix. For example, `MESHCORE_MQTT_WS_PORT` overrides `mqtt.ws_port`. You can point to another configuration file using `MESHCORE_CONFIG`.

### Optional: forward data to another MQTT broker

For example, set the following values in `config.yaml`:

```yaml
target_mqtt:
  url: "mqtts://mqtt.example.org:8883"
  username: "your-target-username"
  password: "your-target-password"
  reject_unauthorized: true
```

Replace the example values with those for your MQTT service. This forwards accepted observer-owned `status`, `packets`, and `neighbors` messages. Forwarding uses **QoS 0** and is **at most once**: messages that cannot be forwarded are dropped rather than stored for later retry. The original MQTT `RETAIN` flag is preserved. The external broker may keep retained messages even after this broker restarts.

### Optional: MeshCore.io map uploads

Set `meshcore_io.enabled: true` only if you want this broker to upload eligible, cryptographically verified node adverts. Review the other `meshcore_io` settings, including the signing key, before enabling it. Uploads are **off by default**.

## Running it safely

For an internet-facing deployment:

1. Put the broker behind a reverse proxy (for example, Traefik) that provides **HTTPS/WSS** and appropriate access and rate limiting.
2. Do **not** expose the broker's plaintext `ws://` listener directly to the internet.
3. Use strong, unique passwords; keep `config.yaml` private and mount it read-only.
4. Configure `mqtt.trusted_proxies` only with the actual proxy IP addresses or CIDR ranges. Leave it empty for direct local connections.
5. Consider restricting public access to **`GET /status`**, which is unauthenticated and exposes operational metadata.

See [SECURITY.md](SECURITY.md) for more deployment and vulnerability-reporting guidance.

### What happens to stored messages?

The broker is **stateless**. MQTT sessions, retained messages, and other runtime information live in **RAM only**. Restarting the broker clears that data. There is no database or persistent data volume to configure.

Retained messages follow the sender's MQTT `RETAIN` flag; they are **not** automatically removed after 48 hours and there is no fixed 10,000-topic cap. An MQTT 5 message-expiry interval may remove an individual message. Monitor memory usage if you expect many retained topics. Administrator-published retained serial commands can be replayed to a reconnecting observer until cleared; avoid retaining commands unless that is intentional.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **The status page does not open** | Run `docker compose ps` and `docker compose logs --tail=100`; verify the host port in `compose.yaml`. |
| **My MQTT client cannot connect** | Select **WebSocket** rather than TCP MQTT; use `/mqtt` and the correct `ws://` or reverse-proxy `wss://` endpoint. |
| **Login is rejected** | Verify the account/password in `subscribers.users`. For observers, check the signed token, public key, and `auth.expected_audience`. |
| **I see heartbeats but no device data** | Make sure an observer is actually connected, publishing to an allowed primary IATA code, and that you subscribed to `meshcore/#` or a matching topic. |
| **My proxy connection fails** | Check TLS termination and WebSocket forwarding in the proxy; configure `mqtt.trusted_proxies` only for trusted proxy addresses. |
| **Messages disappear on restart** | This is expected: this broker's retained data is memory-only. External target brokers have independent retention. |

Useful commands:

```bash
docker compose logs -f             # Follow log output
docker compose restart             # Restart after configuration changes
docker compose pull                # Fetch the current image
docker compose up -d               # Recreate/start with the image and settings
docker compose down                # Stop and remove the container
```

You can report a problem or request a feature using [GitHub Issues](https://github.com/Bjorkan/meshcore-mqtt-broker/issues). Please do not include passwords, tokens, private keys, or sensitive configuration in reports.

## For developers and advanced operators

The broker is implemented in **Rust**, using an embedded MQTT engine. The repository pins **Rust 1.99**. To run and test from source:

```bash
cargo run --locked --release
cargo test --all-targets --locked
```

For architectural notes and detailed verification commands, see [RUST.md](RUST.md). For module-specific documentation, see [src/README.md](src/README.md). For optional external integration checks, see [tests/external/README.md](tests/external/README.md).

## AI-generated code disclaimer

The source code in this project was **created using OpenAI GPT-6, with light human guidance and oversight**. While care has been taken to test and verify the implementation, AI-generated code can contain mistakes, bugs, or security vulnerabilities. Review and evaluate the code and its configuration carefully before using it in a production environment. The software is provided **as is**, without warranty, as described in the license below.

## License

Released under the [MIT License](LICENSE.md). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for additional attribution.
