# Observer error codes — how firmware reads them

Checked against the supplied `MeshCore-observer-firmware-dev.zip` snapshot
`79a0e8404dc194eadd724da9916e82ac9c7151e0` (C++ ESP32 observer,
`src/helpers/bridges/MQTTBridge.cpp`) and
[`Cisien/meshcoretomqtt`](https://github.com/Cisien/meshcoretomqtt)
(Python bridge, `bridge/mqtt_manager.py` + `bridge/remote_serial.py`).
Neither client subscribes to an error topic today — so neither one sees
broker denial codes today. This document shows exactly what each client
observes per failure, and the one subscription each needs to add.

## The two channels

| Channel                                                 | Reaches firmware?  | Content                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MQTT 3.1.1 CONNACK `returnCode`                         | Yes, bare number   | `5` = not authorized. **No reason string on the wire — `[CODE] detail` never reaches any client.** Codes are broker-log only.                                                                                                                             |
| `meshcore/<IATA>/<OWN_KEY>/error` (QoS 0, broker-owned) | Only if subscribed | JSON `{ code, message, topic?, iata?, at }` with a stable `code` from the table in `CONFIGURATION.md`. Payload is at most 768 bytes for the firmware's 896-byte MQTT RX buffer. Awaited ≤400 ms before any close, so a subscribed QoS 0 observer sees it. |

Subscribe at connect, before the first publish:

- `meshcore/<IATA>/<OWN_KEY>/error` (exact), plus
- `meshcore/XXX/<OWN_KEY>/error` until the first successful publish reveals the working IATA (an unrecoverable/malformed topic falls back to `XXX`; a well-formed but unlisted IATA uses its requested IATA error topic), plus optionally
- `meshcore/<IATA>/<OWN_KEY>/error/#` if the client wants per-code filtering (approved on the observer's own channel; the broker only ever publishes the exact topic).

The broker never accepts publishes to `.../error`. Other observers' error topics are closed (publishers get `PUBLISH_RESERVED_SUBTOPIC` + disconnect; subscribers get filtered `null`).

## What each client sees today (no error subscription)

### Auth failures (both clients)

| Failure                                      | C++ observer-fw sees                                                                            | meshcoretomqtt sees                                      | Broker code (log only)                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Wrong username format / bad key              | `get mqttN.diag` shows `refused: not authorized (5)`; the individual broker code is unavailable | `Connection failed with code: N` (`mqtt_manager.py:210`) | `AUTH_INVALID_USERNAME_FORMAT`, `AUTH_INVALID_PUBLIC_KEY` |
| Bad JWT signature                            | same as above                                                                                   | same as above                                            | `AUTH_INVALID_TOKEN`                                      |
| Expired `exp` / `iat` too old / future `iat` | same as above (looks like generic disconnect/reconnect)                                         | same as above                                            | `AUTH_STALE_TOKEN` — re-issue with a correct clock        |
| Wrong `aud`                                  | same as above                                                                                   | same as above                                            | `AUTH_WRONG_AUDIENCE`                                     |
| Subscriber wrong password                    | n/a (JWT or user/pass presets)                                                                  | `Connection failed with code: N`                         | `AUTH_INVALID_PASSWORD`                                   |
| Too many sessions                            | reconnect ladder keeps failing                                                                  | reconnect/backoff, `failed_attempts`                     | `SUBSCRIBER_CONNECTION_LIMIT` — close a socket first      |
| Broker restarting                            | `disc` → backoff ladder                                                                         | disconnect + reconnect                                   | `AUTH_SHUTTING_DOWN`                                      |

The dev firmware now preserves and labels the MQTT 3.1.1 CONNACK code, but code 5 cannot distinguish the broker's `AUTH_*` reasons. Those remain distinguishable only in broker logs. On the firmware side, fix auth by checking (1) `username=v1_<64-hex-KEY>`,
(2) JWT `aud` = broker `auth.expected_audience`, (3) clock/NTP (C++ needs NTP before JWT),
(4) token freshness (`meshcoretomqtt` caches to `ttl-300`; C++ default lifetime 24 h).

### Publish denials (both clients publish QoS 0, C++ status QoS 1)

| Failure                                             | C++ observer-fw sees                                                                                                            | meshcoretomqtt sees                                              | Broker code (needs `/error` subscription)                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unlisted / malformed IATA                           | **Nothing** — blocked locally (`XXX`/empty never sent, `MQTTBridge.cpp:2747`), or QoS 0 sync returns success while broker drops | QoS 0 `publish()` returns success locally; data silently missing | `PUBLISH_UNKNOWN_IATA`, `PUBLISH_INVALID_IATA_FORMAT`, `PUBLISH_PLACEHOLDER_IATA`, `PUBLISH_SECONDARY_IATA`, `PUBLISH_TEST_INGRESS_DISABLED` |
| Topic key ≠ auth key                                | Impossible (always own `_device_id`)                                                                                            | Impossible (`origin_id` always own key)                          | `PUBLISH_KEY_MISMATCH` (still enforced)                                                                                                      |
| Bad / missing `origin_id`                           | Impossible (always set)                                                                                                         | Impossible                                                       | `PUBLISH_ORIGIN_MISSING` / `MISMATCH` / `PUBLISH_INVALID_JSON`                                                                               |
| Stale connection (same key, newer socket took over) | Generic disconnect/reconnect ladder                                                                                             | Generic disconnect/backoff                                       | `PUBLISH_STALE_CONNECTION` — reconnect to take over                                                                                          |
| Older device timestamp on `status`                  | Silent drop; QoS 1 can still complete locally                                                                                   | Silent drop                                                      | `PUBLISH_STALE_STATUS` — check observer clock                                                                                                |
| Publish to `error`/`internal`/`serial/*`/`raw/*`    | `/raw` is sent if `mqtt.raw` is enabled; the other reserved paths are not emitted by the normal router                          | `raw` template exists but is never published                     | `PUBLISH_RESERVED_SUBTOPIC` / `PUBLISH_SERIAL_RESPONSE_INVALID`                                                                              |
| Payload over size limit                             | QoS 0 silent; QoS 1 throttled log                                                                                               | `Publish failed` log + counter only on socket error              | `PUBLISH_PAYLOAD_TOO_LARGE`                                                                                                                  |

Key point: **a broker publish denial is invisible to both firmwares today** — QoS 0 `publish()` succeeding locally means "bytes left the socket", not "broker accepted". The only way to see the code is the `/error` subscription below.

### Subscribe denials

- C++ firmware never registers an inbound MQTT topic. Its bundled `PsychicMqttClient` supports persistent `onTopic()` registrations and automatically resubscribes before the bridge's `onConnect` callback, so it needs an `onTopic()` handler for `/error`.
- `meshcoretomqtt` subscribes only to `meshcore/<global_iata>/<pubkey>/serial/commands` (QoS 1, `remote_serial.py:42`) and drops any other incoming topic (`mqtt_manager.py:268`). A `serial/commands` subscribe with an unlisted IATA is denied with `PUBLISH_UNKNOWN_IATA` **without** closing (error channel stays alive); any other publisher subscribe is denied with `PUBLISH_RESERVED_SUBTOPIC` **and disconnects**.

## What to add per firmware

### C++ observer-firmware (`MQTTBridge.cpp`)

1. Register `onTopic("meshcore/<IATA>/<DEVICE>/error", 0, handler)` and `onTopic("meshcore/XXX/<DEVICE>/error", 0, handler)` once when the slot client is created, before `connect()`. `PsychicMqttClient` then subscribes on every reconnect before `onConnect` schedules the first status publish. Do this only for the `meshat.se` preset (or a custom endpoint known to implement this contract); subscribing on unrelated community brokers may be rejected by their ACLs.
2. Parse `{ code, message, topic?, iata?, at }` with a bounded JSON document and store the last `code` per slot. Surface it in `get mqttN.diag` and the web status panel. A truncated diagnostic string can end in `...`, but `code` and `at` are always preserved.
3. The exact error topic is under 128 bytes and the two registrations fit the client's four-entry `PSYCHIC_MAX_MESSAGE_CB` table. Avoid a broad `meshcore/+/<DEVICE>/error` subscription: this broker deliberately authorizes exact own-key error channels, not a cross-IATA wildcard.
4. Keep the local `XXX` gate if desired, but note the broker also rejects `XXX` (`PUBLISH_PLACEHOLDER_IATA` + close). The `XXX/error` fallback is required for clients or future configuration paths that can connect before a valid IATA is known.

The dev firmware defaults `mqtt.raw` to off; keep it off for `meshat.se`. The broker deliberately denies the deprecated `/raw` topic because the same bytes are already carried in `/packets.raw`. Enabling it would create one `PUBLISH_RESERVED_SUBTOPIC` notification per raw publish without adding data.

### meshcoretomqtt (Python)

1. In `mqtt_manager.on_mqtt_connect`, alongside `subscribe_serial_commands`, subscribe `meshcore/<global_iata>/<repeater_pub_key>/error` and `meshcore/XXX/<repeater_pub_key>/error` (QoS 0 or 1).
2. Extend `on_mqtt_message` (currently drops non-`/serial/commands`) to route `.../error` payloads to a handler that logs `code`/`message`/`topic` — today a publish denial is a silent success with missing data.
3. `global_iata` defaults to `XXX` (`bridge/state.py:67`): with the default config every publish is denied with `PUBLISH_PLACEHOLDER_IATA` (and the socket closed). The `XXX/error` subscription is what makes that misconfiguration visible instead of "connected, no data".

## Broker guarantees relied on above

- `/error` subscribe is approved for the observer's **own** key at **any** IATA (including `XXX` and unlisted codes) and for `.../error/#` wildcard filters on the own channel; other keys stay denied.
- Error JSON is capped at 768 bytes so it fits the current firmware's 896-byte MQTT receive buffer together with the topic and MQTT framing. If diagnostic text must be shortened, `code` and `at` remain intact.
- Publish-denial JSON is awaited (≤400 ms) before any close, so even `close: true` codes (`XXX`, bad IATA format, key mismatch, stale connection) are delivered to a subscribed QoS 0 observer.
- Stale-subscribe attempts are denied WITHOUT closing, so a replaced connection keeps its error channel while it reconnects.
- Full code table and close policy: `CONFIGURATION.md`.
