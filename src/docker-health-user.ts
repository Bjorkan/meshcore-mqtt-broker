import { randomBytes } from "crypto";

export const DOCKER_HEALTH_USERNAME = "docker_health";
export const DOCKER_HEALTH_PASSWORD_LENGTH = 32;
export const DOCKER_HEALTH_MAX_CONNECTIONS = 4;

export interface DockerHealthCredentials {
  username: string;
  password: string;
  createdAt: string;
}

export function generateDockerHealthPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Totally stateless: no healthcheck MQTT user, no credentials, no files.
 * Docker HEALTHCHECK probes GET /status over HTTP (see healthcheck.ts),
 * so the broker keeps zero per-process secrets for health purposes.
 * Kept only for helpers still referencing the historical username.
 */
export function createDockerHealthCredentials(
  now = new Date(),
): DockerHealthCredentials {
  return {
    username: DOCKER_HEALTH_USERNAME,
    password: generateDockerHealthPassword(),
    createdAt: now.toISOString(),
  };
}
