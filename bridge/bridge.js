import mqtt from "mqtt";

const sourceUrl = process.env.SOURCE_MQTT_URL || "ws://broker:8883";
const sourceUser = process.env.SOURCE_MQTT_USERNAME || "uplink";
const sourcePass = process.env.SOURCE_MQTT_PASSWORD || "";

const targetUrl = process.env.TARGET_MQTT_URL || "mqtts://mqtt.example.com:8883";
const targetUser = process.env.TARGET_MQTT_USERNAME || "";
const targetPass = process.env.TARGET_MQTT_PASSWORD || "";

const sourceClientId = process.env.SOURCE_CLIENT_ID || "meshcore-uplink-source";
const targetClientId = process.env.TARGET_CLIENT_ID || "meshcore-uplink-target";

const topicFilter = process.env.TOPIC_FILTER || "meshcore/#";
const targetPrefix = process.env.TARGET_PREFIX || "";

let targetReady = false;

const heartbeatTopic = "mshse/Hjärtslag";
const heartbeatMessage = "Hjärtat slår";
const heartbeatIntervalMs = 30000;

let heartbeatTimer = null;

console.log(`Source: ${sourceUrl}`);
console.log(`Source client ID: ${sourceClientId}`);
console.log(`Target: ${targetUrl}`);
console.log(`Target client ID: ${targetClientId}`);
console.log(`Topic filter: ${topicFilter}`);
console.log(`Target prefix: ${targetPrefix || "(none)"}`);
console.log(`Heartbeat topic: ${heartbeatTopic}`);
console.log(`Heartbeat message: ${heartbeatMessage}`);
console.log(`Heartbeat interval: ${heartbeatIntervalMs} ms`);

const source = mqtt.connect(sourceUrl, {
  username: sourceUser,
  password: sourcePass,
  clientId: sourceClientId,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
});

const target = mqtt.connect(targetUrl, {
  username: targetUser,
  password: targetPass,
  clientId: targetClientId,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  rejectUnauthorized: true,
});

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
    heartbeatTopic,
    heartbeatMessage,
    {
      qos: 1,
      retain: false,
    },
    (err) => {
      if (err) {
        console.error(`Heartbeat publish failed ${heartbeatTopic}:`, err.message);
      } else {
        console.log(`Heartbeat published to ${heartbeatTopic}: ${heartbeatMessage}`);
      }
    }
  );
}

source.on("connect", () => {
  console.log("Connected to source broker");

  source.subscribe(topicFilter, { qos: 0 }, (err) => {
    if (err) {
      console.error("Source subscribe failed:", err.message);
    } else {
      console.log(`Subscribed to source topic: ${topicFilter}`);
    }
  });
});

target.on("connect", () => {
  targetReady = true;
  console.log("Connected to target broker");

  publishHeartbeat();

  stopHeartbeat();
  heartbeatTimer = setInterval(publishHeartbeat, heartbeatIntervalMs);

  console.log(
    `Heartbeat enabled: ${heartbeatTopic} every ${heartbeatIntervalMs} ms`
  );
});

source.on("message", (topic, payload, packet) => {
  if (!targetReady || !target.connected) {
    console.warn(`Target not ready, dropping ${topic}`);
    return;
  }

  const outTopic = `${targetPrefix}${topic}`;

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
