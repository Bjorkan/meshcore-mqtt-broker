import { randomInt } from "crypto";

const BROKER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_BROKER_NAME = "Broker";
function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
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
