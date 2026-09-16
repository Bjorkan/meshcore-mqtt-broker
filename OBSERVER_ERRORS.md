# Observer error codes — how firmware reads them

Checked against [`agessaman/MeshCore` branch `observer-firmware`](https://github.com/agessaman/MeshCore/tree/observer-firmware)
(C++ ESP32 observer, `src/helpers/bridges/MQTTBridge.cpp`) and
[`Cisien/meshcoretomqtt`](https://github.com/Cisien/meshcoretomqtt)
(Python bridge, `bridge/mqtt_manager.py` + `bridge/remote_serial.py`).
Neither client subscribes to an error topic today — so neither one sees
broker denial codes today. This document shows exactly what each client
observes per failure, and the one subscription each needs to add.

## The two channels

| Channel                                                 | Reaches firmware?  | Content                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MQTT 3.1.1 CONNACK `returnCode`                         | Yes, bare number   | `5` = not authorized. **No reason string on the wire — `[CODE] detail` never reaches any client.** Codes are broker-log only.                                                    |
| `meshcore/<IATA>/<OWN_KEY>/error` (QoS 0, broker-owned) | Only if subscribed | JSON `{ code, message, topic?, iata?, at }` with a stable `code` from the table in `CONFIGURATION.md`. Awaited ≤400 ms before any close, so a subscribed QoS 0 observer sees it. |

Subscribe at connect, before the first publish:

- `meshcore/<IATA>/<OWN_KEY>/error` (exact), plus
- `meshcore/XXX/<OWN_KEY>/error` until the first successful publish reveals the working IATA (early failures — malformed topic, unlisted IATA — fall back to `XXX`), plus optionally
- `meshcore/<IATA>/<OWN_KEY>/error/#` if the client wants per-code filtering (approved on the observer's own channel; the broker only ever publishes the exact topic).

The broker never accepts publishes to `.../error`. Other observers' error topics are closed (publishers get `PUBLISH_RESERVED_SUBTOPIC` + disconnect; subscribers get filtered `null`).

## What each client sees today (no error subscription)

### Auth failures (both clients)

| Failure                                      | C++ observer-fw sees                                                                      | meshcoretomqtt sees                                      | Broker code (log only)                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| Wrong username format / bad key              | `disc`, numeric return code only in `MQTT_DEBUG` build (`onError`, `MQTTBridge.cpp:1651`) | `Connection failed with code: N` (`mqtt_manager.py:210`) | `AUTH_INVALID_USERNAME_FORMAT`, `AUTH_INVALID_PUBLIC_KEY` |
| Bad JWT signature                            | same as above                                                                             | same as above                                            | `AUTH_INVALID_TOKEN`                                      |
| Expired `exp` / `iat` too old / future `iat` | same as above (looks like generic disconnect/reconnect)                                   | same as above                                            | `AUTH_STALE_TOKEN` — re-issue with a correct clock        |
| Wrong `aud`                                  | same as above                                                                             | same as above                                            | `AUTH_WRONG_AUDIENCE`                                     |
| Subscriber wrong password                    | n/a (JWT or user/pass presets)                                                            | `Connection failed with code: N`                         | `AUTH_INVALID_PASSWORD`                                   |
| Too many sessions                            | reconnect ladder keeps failing                                                            | reconnect/backoff, `failed_attempts`                     | `SUBSCRIBER_CONNECTION_LIMIT` — close a socket first      |
| Broker restarting                            | `disc` → backoff ladder                                                                   | disconnect + reconnect                                   | `AUTH_SHUTTING_DOWN`                                      |

Neither client parses reason strings, and none exist on the wire: **auth codes are only distinguishable in broker logs.** On the firmware side, fix auth by checking (1) `username=v1_<64-hex-KEY>`,
(2) JWT `aud` = broker `auth.expected_audience`, (3) clock/NTP (C++ needs NTP before JWT, `MQTTBridge.cpp:2000`),
(4) token freshness (`meshcoretomqtt` caches to `ttl-300`; C++ default lifetime 24 h).

### Publish denials (both clients publish QoS 0, C++ status QoS 1)

| Failure                                             | C++ observer-fw sees                                                                                                            | meshcoretomqtt sees                                              | Broker code (needs `/error` subscription)                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unlisted / malformed IATA                           | **Nothing** — blocked locally (`XXX`/empty never sent, `MQTTBridge.cpp:2747`), or QoS 0 sync returns success while broker drops | QoS 0 `publish()` returns success locally; data silently missing | `PUBLISH_UNKNOWN_IATA`, `PUBLISH_INVALID_IATA_FORMAT`, `PUBLISH_PLACEHOLDER_IATA`, `PUBLISH_SECONDARY_IATA`, `PUBLISH_TEST_INGRESS_DISABLED` |
| Topic key ≠ auth key                                | Impossible (always own `_device_id`)                                                                                            | Impossible (`origin_id` always own key)                          | `PUBLISH_KEY_MISMATCH` (still enforced)                                                                                                      |
| Bad / missing `origin_id`                           | Impossible (always set)                                                                                                         | Impossible                                                       | `PUBLISH_ORIGIN_MISSING` / `MISMATCH` / `PUBLISH_INVALID_JSON`                                                                               |
| Stale connection (same key, newer socket took over) | Generic disconnect/reconnect ladder                                                                                             | Generic disconnect/backoff                                       | `PUBLISH_STALE_CONNECTION` — reconnect to take over                                                                                          |
| Older device timestamp on `status`                  | Silent drop (QoS 0 success locally)                                                                                             | Silent drop                                                      | `PUBLISH_STALE_STATUS` — check observer clock                                                                                                |
| Publish to `error`/`internal`/`serial/*`/`raw/*`    | C++ never sends these (router only emits `status/packets/raw/neighbors`)                                                        | `raw` template exists but is never published                     | `PUBLISH_RESERVED_SUBTOPIC` / `PUBLISH_SERIAL_RESPONSE_INVALID`                                                                              |
| Payload over size limit                             | QoS 0 silent; QoS 1 throttled log                                                                                               | `Publish failed` log + counter only on socket error              | `PUBLISH_PAYLOAD_TOO_LARGE`                                                                                                                  |

Key point: **a broker publish denial is invisible to both firmwares today** — QoS 0 `publish()` succeeding locally means "bytes left the socket", not "broker accepted". The only way to see the code is the `/error` subscription below.

### Subscribe denials

- C++ firmware never subscribes (publish-only; `subscribe()` appears only in a comment). It needs a new `subscribe()` + `onMessage` path to read `/error`.
- `meshcoretomqtt` subscribes only to `meshcore/<global_iata>/<pubkey>/serial/commands` (QoS 1, `remote_serial.py:42`) and drops any other incoming topic (`mqtt_manager.py:268`). A `serial/commands` subscribe with an unlisted IATA is denied with `PUBLISH_UNKNOWN_IATA` **without** closing (error channel stays alive); any other publisher subscribe is denied with `PUBLISH_RESERVED_SUBTOPIC` **and disconnects**.

## What to add per firmware

### C++ observer-firmware (`MQTTBridge.cpp`)

1. After `onConnect`, `subscribe("meshcore/<IATA>/<DEVICE>/error", QoS 0)` and `subscribe("meshcore/XXX/<DEVICE>/error", QoS 0)` (uppercase device key, same `v1_` key derivation as the username at `MQTTBridge.cpp:2294`).
2. Add an `onMessage` handler that parses `{ code, message, topic?, iata?, at }` and surfaces `code` in `get mqtt.status` / `get mqtt.stats` (today only `sN=ok/err` counters exist) — at minimum log `code` so `PUBLISH_UNKNOWN_IATA` vs `PUBLISH_STALE_STATUS` vs `PUBLISH_STALE_CONNECTION` are distinguishable without a debug build.
3. Keep the local `XXX` gate if desired, but note the broker ALSO rejects `XXX` (`PUBLISH_PLACEHOLDER_IATA` + close): after fixing the IATA, the `XXX/error` subscription is what delivers that code during bring-up.

### meshcoretomqtt (Python)

1. In `mqtt_manager.on_mqtt_connect`, alongside `subscribe_serial_commands`, subscribe `meshcore/<global_iata>/<repeater_pub_key>/error` and `meshcore/XXX/<repeater_pub_key>/error` (QoS 0 or 1).
2. Extend `on_mqtt_message` (currently drops non-`/serial/commands`) to route `.../error` payloads to a handler that logs `code`/`message`/`topic` — today a publish denial is a silent success with missing data.
3. `global_iata` defaults to `XXX` (`bridge/state.py:67`): with the default config every publish is denied with `PUBLISH_PLACEHOLDER_IATA` (and the socket closed). The `XXX/error` subscription is what makes that misconfiguration visible instead of "connected, no data".

## Broker guarantees relied on above

- `/error` subscribe is approved for the observer's **own** key at **any** IATA (including `XXX` and unlisted codes) and for `.../error/#` wildcard filters on the own channel; other keys stay denied.
- Publish-denial JSON is awaited (≤400 ms) before any close, so even `close: true` codes (`XXX`, bad IATA format, key mismatch, stale connection) are delivered to a subscribed QoS 0 observer.
- Stale-subscribe attempts are denied WITHOUT closing, so a replaced connection keeps its error channel while it reconnects.
- Full code table and close policy: `CONFIGURATION.md`.
