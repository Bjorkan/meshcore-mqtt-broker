import { randomInt } from "crypto";

const BROKER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_BROKER_NAME = "Broker";
// "<Name>-XXXX" with the restricted alphabet; anything else is treated as
// corrupt/foreign and regenerated instead of adopted forever.
export const INSTANCE_ID_PATTERN =
  /^[A-Za-z0-9_-]{1,64}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;

export interface ResolveBrokerInstanceIdOptions {
  brokerName?: string;
  /**
   * Accepted for YAML compatibility only. The broker is fully stateless and
   * keeps the id in process memory; file-backed ids are not supported.
   */
  runtimeIdFile?: string;
}

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

export function resolveBrokerInstanceId(
  options: ResolveBrokerInstanceIdOptions = {},
): string {
  // Fully stateless: a fresh id per process. `runtime_id_file` is accepted
  // for YAML compatibility but ignored; config validation warns when set.
  return formatBrokerInstanceId(generateBrokerCode(), options.brokerName);
}
