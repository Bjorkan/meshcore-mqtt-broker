export const MQTT_HISTORY_PARSER_NAME = "meshcore-mqtt-history";
export const MQTT_HISTORY_PARSER_VERSION = "2";

export interface ParsedPublicMeshcoreTopic {
  topic: string;
  iata: string;
  observerPublicKey: string;
  subtopic: string;
  subtopicRoot: string;
}

export type TopicParseResult =
  | { ok: true; value: ParsedPublicMeshcoreTopic }
  | { ok: false; code: string; message: string };

export function parsePublicMeshcoreTopic(topic: string): TopicParseResult {
  const parts = topic.split("/");
  if (parts.some((part) => !part || part.includes("+") || part.includes("#"))) {
    return {
      ok: false,
      code: "invalid_topic_segments",
      message: "Topic contains an empty segment or MQTT wildcard",
    };
  }
  if (parts[0] !== "meshcore" || parts.length < 4) {
    return {
      ok: false,
      code: "invalid_topic_shape",
      message: "Topic must use meshcore/<IATA>/<observer>/<subtopic>",
    };
  }

  const iata = parts[1];
  if (!/^[A-Z]{3}$/.test(iata)) {
    return {
      ok: false,
      code: "invalid_iata",
      message: "IATA must be exactly three uppercase letters",
    };
  }

  const observerPublicKey = parts[2].toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(observerPublicKey)) {
    return {
      ok: false,
      code: "invalid_observer_public_key",
      message: "Observer public key must be 64 hexadecimal characters",
    };
  }

  const subtopic = parts.slice(3).join("/");
  return {
    ok: true,
    value: {
      topic,
      iata,
      observerPublicKey,
      subtopic,
      subtopicRoot: parts[3].toLowerCase(),
    },
  };
}

export function isPrivateHistorySubtopic(
  subtopicRoot: string,
  options: { storeInternal: boolean; storeSerial: boolean },
): boolean {
  return (
    (subtopicRoot === "internal" && !options.storeInternal) ||
    (subtopicRoot === "serial" && !options.storeSerial)
  );
}
