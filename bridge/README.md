# meshcore-mqtt-broker-bridge

MQTT bridge that subscribes to a source broker and republishes matching messages to a target broker.

Docker image: `bjorkan/meshcore-mqtt-broker-bridge`

## Configuration

Copy `.env.example` to `.env` and set the source and target broker credentials:

```bash
cp .env.example .env
```

The source credentials must match a subscriber user configured on the broker. The root `compose.yaml` example pairs this bridge with the `uplink` subscriber in `../broker/.env.example`.

Heartbeat publishing is enabled by default and can be configured with `HEARTBEAT_ENABLED`, `HEARTBEAT_TOPIC`, `HEARTBEAT_MESSAGE`, and `HEARTBEAT_INTERVAL_MS`.

## MeshCore.io Map Upload

The bridge can also upload heard repeater, room server, and sensor adverts to `map.meshcore.io` directly from MQTT observer data. No MeshCore companion connection is used. Enable it with:

```bash
MESHCOREIO_MAPUPLOAD=true
MESHCOREIO_PUBKEY=<64 hex chars>
MESHCOREIO_PRIVATEKEY=<64 or 128 hex chars>
```

If `MESHCOREIO_MAPUPLOAD=true`, invalid or mismatched map signing keys make the bridge fail at startup. This is intentional so the service does not appear healthy while map uploads can never succeed.

The uploader reads observer `status` messages to remember radio parameters and reads `raw`/`packets` messages for the original MeshCore packet hex. It verifies advert signatures, skips chat adverts, protects against replay/too-frequent uploads, signs the map request with the configured MeshCore.io key, and then posts to `MESHCOREIO_API_URL`.

Supported MQTT messages are expected to contain the type segment `status`, `raw`, or `packets` in the topic. The normal observer topic format is `meshcore/{IATA}/{DEVICE_PUBLIC_KEY}/{type}`. Custom topics are supported when the JSON payload includes `origin_id`, or when the topic contains the observer public key as a 64-character hex segment.

Make sure `TOPIC_FILTER` includes both status and packet topics, for example `meshcore/#`. The uploader does not backfill adverts that arrived before it knew the observer radio settings.

The uploader expects a `status` message before it uploads adverts from an observer. Radio parameters can come from the observer firmware string:

```json
{ "origin_id": "...", "radio": "869.617981,62.5,8,8" }
```

This is `freq,bw,sf,cr`, where frequency is MHz and bandwidth is kHz. Field-based `params`/`freq`/`bw`/`sf`/`cr` values are also accepted. Frequency may be supplied as MHz, kHz, or Hz and is normalized before upload.

For map upload, the `raw` or `data` hex must be the MeshCore packet wire bytes accepted by `Packet.fromBytes(...)`. It must not include an extra wrapper, MQTT envelope, or modem-specific header before the MeshCore packet header byte.

By default, uploads are skipped until complete and sane `freq`, `bw`, `sf`, and `cr` values are known. The uploader only sends verified `REPEATER`, `ROOM`, and `SENSOR` adverts. Later offline/minimal status messages do not overwrite earlier complete radio settings.

`MESHCOREIO_PUBKEY` and `MESHCOREIO_PRIVATEKEY` are the MeshCore identity used to sign map uploads. This identity becomes the uploader or owner identity for `map.meshcore.io`. Keep it stable if you want future updates or removals to be associated with the same uploader, and protect `MESHCOREIO_PRIVATEKEY` like any other private key.

### Observer Firmware Requirements

The MQTT observer should publish:

- `status` messages with `origin_id` and radio params, such as `radio: "freq,bw,sf,cr"`
- `packets` messages with `raw`, or `raw` messages with `data`

Recommended observer settings:

```text
set mqtt.status on
set mqtt.packets on
set mqtt.raw off
set mqtt.rx on
set mqtt.tx advert
set mqtt.iata <REGION>
```

### Manual Smoke Test

1. Configure the observer with the settings above.
2. Verify that retained status arrives on the source broker, for example with `mosquitto_sub -v -t 'meshcore/#'`.
3. Confirm that packet JSON contains `origin_id` and either `packets.raw` or `raw.data`.
4. Start the bridge with `MESHCOREIO_MAPUPLOAD=true` and matching signing keys.
5. Confirm logs show `Kartuppladdning: sparade status ...` followed by `Kartuppladdning: skickar repeater/room/sensor-advert ...`.
6. Confirm the map API response is successful in the bridge logs.

## Usage

```bash
npm install
npm start
```

## Docker

Use this directory as the Docker build context:

```bash
docker build -t bjorkan/meshcore-mqtt-broker-bridge .
```
