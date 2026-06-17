import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import { pathToFileURL } from "url";
import { MeshcoreMapUploader, type MapUploaderConfig } from "./map-uploader.js";

export interface BridgeConfig {
  sourceUrl: string;
  sourceUser: string;
  sourcePass: string;
  targetUrl: string;
  targetUser: string;
  targetPass: string;
  sourceClientId: string;
  targetClientId: string;
  topicFilter: string;
  targetPrefix: string;
  heartbeatEnabled: boolean;
  heartbeatTopic: string;
  heartbeatMessage: string;
  heartbeatIntervalMs: number;
  reconnectPeriodMs: number;
  connectTimeoutMs: number;
  rejectUnauthorized: boolean;
  mapUploader: MapUploaderConfig;
}

export interface BridgeRuntime {
  source: MqttClient;
  target: MqttClient;
  sourceSubscribed: Promise<void>;
  targetConnected: Promise<void>;
  isTargetReady: () => boolean;
  publishHeartbeat: () => void;
  stop: () => Promise<void>;
}

export interface BridgeDependencies {
  connect?: typeof mqtt.connect;
  mapUploader?: {
    handleMqttMessage(topic: string, payload: Buffer): void | Promise<void>;
  };
}

function envBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    sourceUrl: env.SOURCE_MQTT_URL || "ws://broker:8883",
    sourceUser: env.SOURCE_MQTT_USERNAME || "uplink",
    sourcePass: env.SOURCE_MQTT_PASSWORD || "",
    targetUrl: env.TARGET_MQTT_URL || "mqtts://mqtt.example.com:8883",
    targetUser: env.TARGET_MQTT_USERNAME || "",
    targetPass: env.TARGET_MQTT_PASSWORD || "",
    sourceClientId: env.SOURCE_CLIENT_ID || "meshcore-uplink-source",
    targetClientId: env.TARGET_CLIENT_ID || "meshcore-uplink-target",
    topicFilter: env.TOPIC_FILTER || "meshcore/#",
    targetPrefix: env.TARGET_PREFIX || "",
    heartbeatEnabled: envBool(env.HEARTBEAT_ENABLED, true),
    heartbeatTopic: env.HEARTBEAT_TOPIC || "mshse/Hjärtslag",
    heartbeatMessage: env.HEARTBEAT_MESSAGE || "Hjärtat slår",
    heartbeatIntervalMs: envInt(env.HEARTBEAT_INTERVAL_MS, 30000),
    reconnectPeriodMs: envInt(env.MQTT_RECONNECT_PERIOD_MS, 5000),
    connectTimeoutMs: envInt(env.MQTT_CONNECT_TIMEOUT_MS, 30000),
    rejectUnauthorized: envBool(env.TARGET_REJECT_UNAUTHORIZED, true),
    mapUploader: {
      enabled: envBool(env.MESHCOREIO_MAPUPLOAD, false),
      publicKey: env.MESHCOREIO_PUBKEY || "",
      privateKey: env.MESHCOREIO_PRIVATEKEY || "",
      apiUrl: env.MESHCOREIO_API_URL || "https://map.meshcore.io/api/v1/uploader/node",
      minReuploadIntervalSeconds: envInt(env.MESHCOREIO_MIN_REUPLOAD_SECONDS, 3600),
      requestTimeoutMs: envInt(env.MESHCOREIO_REQUEST_TIMEOUT_MS, 10000),
      retryCooldownMs: envInt(env.MESHCOREIO_RETRY_COOLDOWN_MS, 300000),
      requireCompleteRadioParams: envBool(env.MESHCOREIO_REQUIRE_RADIO_PARAMS, true),
    },
  };
}

export function startBridge(
  config: BridgeConfig = loadBridgeConfig(),
  dependencies: BridgeDependencies = {}
): BridgeRuntime {
  let targetReady = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let resolveSourceSubscribed: () => void = () => {};
  let rejectSourceSubscribed: (err: Error) => void = () => {};
  let resolveTargetConnected: () => void = () => {};
  const connect = dependencies.connect || mqtt.connect;
  const mapUploader = dependencies.mapUploader
    ?? (config.mapUploader.enabled ? new MeshcoreMapUploader(config.mapUploader) : null);

  const sourceSubscribed = new Promise<void>((resolve, reject) => {
    resolveSourceSubscribed = resolve;
    rejectSourceSubscribed = reject;
  });

  const targetConnected = new Promise<void>((resolve) => {
    resolveTargetConnected = resolve;
  });

  console.log(`Source: ${config.sourceUrl}`);
  console.log(`Source client ID: ${config.sourceClientId}`);
  console.log(`Target: ${config.targetUrl}`);
  console.log(`Target client ID: ${config.targetClientId}`);
  console.log(`Topic filter: ${config.topicFilter}`);
  console.log(`Target prefix: ${config.targetPrefix || "(none)"}`);
  console.log(`Heartbeat enabled: ${config.heartbeatEnabled}`);
  console.log(`Heartbeat topic: ${config.heartbeatTopic}`);
  console.log(`Heartbeat message: ${config.heartbeatMessage}`);
  console.log(`Heartbeat interval: ${config.heartbeatIntervalMs} ms`);
  console.log(`MeshCore.io kartuppladdning: ${config.mapUploader.enabled ? "på" : "av"}`);
  if (config.mapUploader.enabled) {
    console.log(`MeshCore.io kart-API: ${config.mapUploader.apiUrl}`);
  }

  const commonOptions: IClientOptions = {
    clean: true,
    reconnectPeriod: config.reconnectPeriodMs,
    connectTimeout: config.connectTimeoutMs,
  };

  const source = connect(config.sourceUrl, {
    ...commonOptions,
    username: config.sourceUser,
    password: config.sourcePass,
    clientId: config.sourceClientId,
  });

  const target = connect(config.targetUrl, {
    ...commonOptions,
    username: config.targetUser,
    password: config.targetPass,
    clientId: config.targetClientId,
    rejectUnauthorized: config.rejectUnauthorized,
  } as IClientOptions);

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function publishHeartbeat() {
    if (!targetReady || !target.connected) {
      console.warn("Target not ready, skipping heartbeat");
      return;
    }

    target.publish(
      config.heartbeatTopic,
      config.heartbeatMessage,
      {
        qos: 1,
        retain: false,
      },
      (err) => {
        if (err) {
          console.error(`Heartbeat publish failed ${config.heartbeatTopic}:`, err.message);
        } else {
          console.log(`Heartbeat published to ${config.heartbeatTopic}: ${config.heartbeatMessage}`);
        }
      }
    );
  }

  source.on("connect", () => {
    console.log("Connected to source broker");

    source.subscribe(config.topicFilter, { qos: 0 }, (err) => {
      if (err) {
        console.error("Source subscribe failed:", err.message);
        rejectSourceSubscribed(err);
      } else {
        console.log(`Subscribed to source topic: ${config.topicFilter}`);
        resolveSourceSubscribed();
      }
    });
  });

  target.on("connect", () => {
    targetReady = true;
    console.log("Connected to target broker");
    resolveTargetConnected();

    if (config.heartbeatEnabled) {
      publishHeartbeat();

      stopHeartbeat();
      heartbeatTimer = setInterval(publishHeartbeat, config.heartbeatIntervalMs);

      console.log(
        `Heartbeat enabled: ${config.heartbeatTopic} every ${config.heartbeatIntervalMs} ms`
      );
    } else {
      console.log("Heartbeat disabled");
    }
  });

  source.on("message", (topic, payload, packet) => {
    // Kartuppladdaren lyssnar på samma MQTT-data som bridgen och använder bara raw/status-info.
    void Promise.resolve(mapUploader?.handleMqttMessage(topic, Buffer.from(payload))).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Kartuppladdning misslyckades:", message);
      }
    );

    if (!targetReady || !target.connected) {
      console.warn(`Target not ready, dropping ${topic}`);
      return;
    }

    const outTopic = `${config.targetPrefix}${topic}`;

    target.publish(
      outTopic,
      payload,
      {
        qos: 0,
        retain: packet.retain || false,
      },
      (err) => {
        if (err) {
          console.error(`Publish failed ${outTopic}:`, err.message);
        } else {
          console.log(`Forwarded ${topic} -> ${outTopic}`);
        }
      }
    );
  });

  source.on("error", (err) => console.error("Source error:", err.message));
  target.on("error", (err) => console.error("Target error:", err.message));

  source.on("close", () => console.warn("Source disconnected"));

  target.on("close", () => {
    targetReady = false;
    stopHeartbeat();
    console.warn("Target disconnected");
  });

  source.on("offline", () => console.warn("Source offline"));

  target.on("offline", () => {
    targetReady = false;
    stopHeartbeat();
    console.warn("Target offline");
  });

  async function stop() {
    stopHeartbeat();

    await Promise.all([
      new Promise<void>((resolve) => source.end(true, {}, () => resolve())),
      new Promise<void>((resolve) => target.end(true, {}, () => resolve())),
    ]);
  }

  return {
    source,
    target,
    sourceSubscribed,
    targetConnected,
    isTargetReady: () => targetReady,
    publishHeartbeat,
    stop,
  };
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isEntrypoint()) {
  startBridge();
}
