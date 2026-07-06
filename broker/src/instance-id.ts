import { randomInt } from 'crypto';
import { dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const DEFAULT_INSTANCE_ID_FILE = '/tmp/mc-mqtt-broker-id';
const BROKER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const DEFAULT_BROKER_NAME = 'Broker';

export interface ResolveBrokerInstanceIdOptions {
  env?: NodeJS.ProcessEnv;
  persist?: boolean;
}

function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function defaultBrokerInstanceIdFile(env: NodeJS.ProcessEnv = process.env): string {
  return cleanId(env.BROKER_RUNTIME_ID_FILE) || DEFAULT_INSTANCE_ID_FILE;
}

export function generateBrokerCode(length = 4): string {
  let code = '';
  for (let index = 0; index < length; index++) {
    code += BROKER_CODE_ALPHABET[randomInt(BROKER_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeBrokerName(value: string | undefined): string {
  const normalized = cleanId(value)
    ?.replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || DEFAULT_BROKER_NAME;
}

export function formatBrokerInstanceId(code = generateBrokerCode(), brokerName = DEFAULT_BROKER_NAME): string {
  return `${normalizeBrokerName(brokerName)}-${code.toUpperCase()}`;
}

function readInstanceIdFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return cleanId(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeInstanceIdFile(path: string, instanceId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${instanceId}\n`, { mode: 0o644 });
}

export function resolveBrokerInstanceId(options: ResolveBrokerInstanceIdOptions = {}): string {
  const env = options.env || process.env;
  const instanceIdFile = defaultBrokerInstanceIdFile(env);

  const generated = formatBrokerInstanceId(generateBrokerCode(), env.BROKER_NAME);
  if (options.persist) {
    writeInstanceIdFile(instanceIdFile, generated);
    return generated;
  }

  const fileInstanceId = readInstanceIdFile(instanceIdFile);
  if (fileInstanceId) {
    return fileInstanceId;
  }

  const envInstanceId = cleanId(env.BROKER_INSTANCE_ID);
  if (envInstanceId) {
    return envInstanceId;
  }

  return generated;
}
