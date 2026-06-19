import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import { pathToFileURL } from "url";

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
  debugEnabled: boolean;
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
}

const RESET_LOG_COLOR = "\x1b[0m";
const LOG_COLORS = {
  muted: "\x1b[90m",
  debug: "\x1b[90m",
  bridge: "\x1b[36m",
  source: "\x1b[96m",
  target: "\x1b[94m",
  mqtt: "\x1b[94m",
  heartbeat: "\x1b[90m",
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  deny: "\x1b[31m",
  error: "\x1b[91m",
  topic: "\x1b[96m",
  url: "\x1b[94m",
  clientName: "\x1b[36m",
  nodeId: "\x1b[95m",
  number: "\x1b[37m",
};

const BRIDGE_CATEGORY_COLORS: Record<string, string> = {
  Bridge: LOG_COLORS.bridge,
  Källa: LOG_COLORS.source,
  Mål: LOG_COLORS.target,
  MQTT: LOG_COLORS.mqtt,
  Heartbeat: LOG_COLORS.heartbeat,
};

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

function shouldColorizeLogs(): boolean {
  return process.env.NO_COLOR === undefined && process.env.LOG_COLOR !== "false";
}

function colorForLabel(label: string): string {
  const category = label.replace(/\s+\d{2}:\d{2}$/, "");
  return BRIDGE_CATEGORY_COLORS[category] ?? LOG_COLORS.bridge;
}

function colorizeBridgePrefix(label: string): string {
  return shouldColorizeLogs()
    ? `[${colorForLabel(label)}${label}${RESET_LOG_COLOR}]`
    : `[${label}]`;
}

export function formatBridgeLogPrefix(category: string, date = new Date()): string {
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return colorizeBridgePrefix(`${category} ${time}`);
}

function bridgeLogTime(date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function rawBridgeLogPrefix(category: string, date = new Date()): string {
  return `[${category} ${bridgeLogTime(date)}]`;
}

function colorizeMatches(message: string, pattern: RegExp, color: string): string {
  const ansiCodes: string[] = [];
  const protectedMessage = message.replace(/\x1b\[[0-9;]+m/g, (match) => {
    const token = `\uE000${String.fromCharCode(0xE100 + ansiCodes.length)}\uE001`;
    ansiCodes.push(match);
    return token;
  });
  const colorized = protectedMessage.replace(pattern, (match) => `${color}${match}${RESET_LOG_COLOR}`);
  return colorized.replace(/\uE000(.)\uE001/g, (_match, marker: string) => ansiCodes[marker.charCodeAt(0) - 0xE100] ?? "");
}

export function colorizeBridgeLogLine(message: string): string {
  if (!shouldColorizeLogs()) {
    return message;
  }

  const prefixMatch = message.match(/^(\[([^\]]+)\]\s?)(.*)$/s);
  const prefix = prefixMatch
    ? `[${colorForLabel(prefixMatch[2])}${prefixMatch[2]}${RESET_LOG_COLOR}]${prefixMatch[1].endsWith(" ") ? " " : ""}`
    : "";
  let body = prefixMatch ? prefixMatch[3] : message;

  body = colorizeMatches(body, /\bDEBUG\b/g, LOG_COLORS.debug);
  body = colorizeMatches(body, /<[^>]+>/g, LOG_COLORS.muted);
  body = colorizeMatches(body, /\b(?:Kunde inte|Misslyckades|Source broker-fel|Target broker-fel)\b/gi, LOG_COLORS.error);
  body = colorizeMatches(body, /\b(?:Nekar|nekad|nekat|Avvisar|Ogiltig|Ogiltigt|ogiltig|ogiltigt|inte giltigt|saknar giltigt)\b/gi, LOG_COLORS.deny);
  body = colorizeMatches(body, /\b(?:Släpper|släpper|Hoppar över|Avstängt|frånkopplad|offline)\b/gi, LOG_COLORS.warn);
  body = colorizeMatches(body, /\b(?:godkänd|godkänt|Ansluten|Publicerade|Forwarded|på)\b/gi, LOG_COLORS.ok);
  body = colorizeMatches(body, /\b(?:heartbeat|Hjärtslag|Hjärtat slår)\b/gi, LOG_COLORS.muted);
  body = colorizeMatches(body, /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, LOG_COLORS.url);
  body = colorizeMatches(body, /\b(?:meshcore\/[^\s")]+|mshse\/[^\s")]+|heartbeat\/)\b/g, LOG_COLORS.topic);
  body = colorizeMatches(body, /\([A-Fa-f0-9]{6,8}\)|\b[A-Fa-f0-9]{6,8}\b/g, LOG_COLORS.nodeId);
  body = colorizeMatches(body, /\b[A-Z]{2}-[A-Z]{2,3}-[A-Z0-9-]+\b|\b(?:meshcore-uplink-source|meshcore-uplink-target)\b/g, LOG_COLORS.clientName);
  body = colorizeMatches(body, /\b\d+\s*ms\b|\b\d+s\b|\b\d+m\b/g, LOG_COLORS.number);
  body = colorizeMatches(body, /\s->\s/g, LOG_COLORS.muted);

  return `${prefix}${body}`;
}

function logBridge(category: string, message: string): void {
  console.log(colorizeBridgeLogLine(`${rawBridgeLogPrefix(category)} ${message}`));
}

function warnBridge(category: string, message: string): void {
  console.warn(colorizeBridgeLogLine(`${rawBridgeLogPrefix(category)} ${message}`));
}

function errorBridge(category: string, message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(colorizeBridgeLogLine(`${rawBridgeLogPrefix(category)} ${message}`));
  } else {
    console.error(colorizeBridgeLogLine(`${rawBridgeLogPrefix(category)} ${message}`), error);
  }
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
    debugEnabled: envBool(env.BRIDGE_DEBUG ?? env.DEBUG, false),
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
  const debug = (category: string, message: string) => {
    if (config.debugEnabled) {
      console.debug(colorizeBridgeLogLine(`${rawBridgeLogPrefix(category)} ${message}`));
    }
  };

  const sourceSubscribed = new Promise<void>((resolve, reject) => {
    resolveSourceSubscribed = resolve;
    rejectSourceSubscribed = reject;
  });

  const targetConnected = new Promise<void>((resolve) => {
    resolveTargetConnected = resolve;
  });

  logBridge("Bridge", `Source: ${config.sourceUrl}`);
  logBridge("Bridge", `Source client ID: ${config.sourceClientId}`);
  logBridge("Bridge", `Target: ${config.targetUrl}`);
  logBridge("Bridge", `Target client ID: ${config.targetClientId}`);
  logBridge("Bridge", `Topic filter: ${config.topicFilter}`);
  logBridge("Bridge", `Target prefix: ${config.targetPrefix || "(none)"}`);
  logBridge("Heartbeat", `Enabled: ${config.heartbeatEnabled}`);
  logBridge("Heartbeat", `Topic: ${config.heartbeatTopic}`);
  logBridge("Heartbeat", `Message: ${config.heartbeatMessage}`);
  logBridge("Heartbeat", `Interval: ${config.heartbeatIntervalMs} ms`);

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
      warnBridge("Heartbeat", "Målbroker är inte redo. Hoppar över heartbeat.");
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
          errorBridge("Heartbeat", `Kunde inte publicera heartbeat på ${config.heartbeatTopic}:`, err.message);
        } else {
          debug("Heartbeat", `Publicerade ${config.heartbeatTopic}: ${config.heartbeatMessage}`);
        }
      }
    );
  }

  source.on("connect", () => {
    logBridge("Källa", "Ansluten till source broker.");

    source.subscribe(config.topicFilter, { qos: 0 }, (err) => {
      if (err) {
        errorBridge("Källa", "Kunde inte prenumerera på source topic:", err.message);
        rejectSourceSubscribed(err);
      } else {
        logBridge("Källa", `Prenumererar på source topic: ${config.topicFilter}`);
        resolveSourceSubscribed();
      }
    });
  });

  target.on("connect", () => {
    targetReady = true;
    logBridge("Mål", "Ansluten till target broker.");
    resolveTargetConnected();

    if (config.heartbeatEnabled) {
      publishHeartbeat();

      stopHeartbeat();
      heartbeatTimer = setInterval(publishHeartbeat, config.heartbeatIntervalMs);

      logBridge("Heartbeat", `Publicerar ${config.heartbeatTopic} var ${config.heartbeatIntervalMs} ms.`);
    } else {
      logBridge("Heartbeat", "Avstängt.");
    }
  });

  source.on("message", (topic, payload, packet) => {
    if (!targetReady || !target.connected) {
      warnBridge("Mål", `Målbroker är inte redo. Släpper ${topic}.`);
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
          errorBridge("MQTT", `Kunde inte publicera ${outTopic}:`, err.message);
        } else {
          debug("MQTT", `Forwarded ${topic} -> ${outTopic}`);
        }
      }
    );
  });

  source.on("error", (err) => errorBridge("Källa", "Source broker-fel:", err.message));
  target.on("error", (err) => errorBridge("Mål", "Target broker-fel:", err.message));

  source.on("close", () => warnBridge("Källa", "Source broker frånkopplad."));

  target.on("close", () => {
    targetReady = false;
    stopHeartbeat();
    warnBridge("Mål", "Target broker frånkopplad.");
  });

  source.on("offline", () => warnBridge("Källa", "Source broker offline."));

  target.on("offline", () => {
    targetReady = false;
    stopHeartbeat();
    warnBridge("Mål", "Target broker offline.");
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
