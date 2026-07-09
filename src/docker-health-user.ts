import { randomBytes } from "crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export const DOCKER_HEALTH_USERNAME = "docker_health";
export const DOCKER_HEALTH_PASSWORD_LENGTH = 32;
export const DOCKER_HEALTH_MAX_CONNECTIONS = 2;
export const DEFAULT_DOCKER_HEALTH_CREDENTIALS_FILE =
  "/tmp/meshcore-mqtt-broker/docker_health_credentials.json";
export const HEALTH_MQTT_CREDENTIALS_FILE =
  DEFAULT_DOCKER_HEALTH_CREDENTIALS_FILE;

export interface DockerHealthCredentials {
  username: string;
  password: string;
  createdAt: string;
}

export function resolveDockerHealthCredentialsFile(): string {
  return HEALTH_MQTT_CREDENTIALS_FILE;
}

export function generateDockerHealthPassword(): string {
  return randomBytes(24).toString("base64url");
}

function validateDockerHealthCredentials(
  value: unknown,
  filePath: string,
): DockerHealthCredentials {
  if (!value || typeof value !== "object") {
    throw new Error(
      `Healthcheck credentials in ${filePath} are not a valid JSON object`,
    );
  }

  const credentials = value as Partial<DockerHealthCredentials>;
  if (credentials.username !== DOCKER_HEALTH_USERNAME) {
    throw new Error(
      `Healthcheck credentials in ${filePath} have the wrong username`,
    );
  }

  if (
    typeof credentials.password !== "string" ||
    credentials.password.length !== DOCKER_HEALTH_PASSWORD_LENGTH
  ) {
    throw new Error(
      `Healthcheck credentials in ${filePath} are missing a ${DOCKER_HEALTH_PASSWORD_LENGTH}-character password`,
    );
  }

  if (
    typeof credentials.createdAt !== "string" ||
    credentials.createdAt.trim() === ""
  ) {
    throw new Error(
      `Healthcheck credentials in ${filePath} are missing createdAt`,
    );
  }

  return {
    username: credentials.username,
    password: credentials.password,
    createdAt: credentials.createdAt,
  };
}

export function createDockerHealthCredentials(
  filePath = resolveDockerHealthCredentialsFile(),
  now = new Date(),
): DockerHealthCredentials {
  const credentials: DockerHealthCredentials = {
    username: DOCKER_HEALTH_USERNAME,
    password: generateDockerHealthPassword(),
    createdAt: now.toISOString(),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // The mode option above is enough on normal Linux filesystems. Ignore chmod
    // errors so non-POSIX development environments can still run tests.
  }

  return credentials;
}

export function readDockerHealthCredentials(
  filePath = resolveDockerHealthCredentialsFile(),
): DockerHealthCredentials {
  const rawContent = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(rawContent) as unknown;
  return validateDockerHealthCredentials(parsed, filePath);
}
