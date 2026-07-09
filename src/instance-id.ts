import { randomInt } from "crypto";
import { dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const DEFAULT_INSTANCE_ID_FILE = "/tmp/mc-mqtt-broker-id";
const BROKER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_BROKER_NAME = "Broker";

export interface ResolveBrokerInstanceIdOptions {
  persist?: boolean;
  brokerName?: string;
  runtimeIdFile?: string;
}

function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function defaultBrokerInstanceIdFile(): string {
  return DEFAULT_INSTANCE_ID_FILE;
}

export function generateBrokerCode(length = 4): string {
  let code = "";
  for (let index = 0; index < length; index++) {
    code += BROKER_CODE_ALPHABET[randomInt(BROKER_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeBrokerName(value: string | undefined): string {
  const normalized = cleanId(value)
    ?.replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || DEFAULT_BROKER_NAME;
}

export function formatBrokerInstanceId(
  code = generateBrokerCode(),
  brokerName = DEFAULT_BROKER_NAME,
): string {
  return `${normalizeBrokerName(brokerName)}-${code.toUpperCase()}`;
}

function readInstanceIdFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return cleanId(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeInstanceIdFile(path: string, instanceId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${instanceId}\n`, { mode: 0o644 });
}

export function resolveBrokerInstanceId(
  options: ResolveBrokerInstanceIdOptions = {},
): string {
  const instanceIdFile =
    cleanId(options.runtimeIdFile) || defaultBrokerInstanceIdFile();

  const generated = formatBrokerInstanceId(
    generateBrokerCode(),
    options.brokerName,
  );
  if (options.persist) {
    writeInstanceIdFile(instanceIdFile, generated);
    return generated;
  }

  const fileInstanceId = readInstanceIdFile(instanceIdFile);
  if (fileInstanceId) {
    return fileInstanceId;
  }

  return generated;
}
