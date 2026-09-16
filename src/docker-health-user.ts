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
 * Fully in-memory healthcheck credentials. The stateless broker has no
 * volume: credentials are generated per process and shared between the
 * broker and its Docker HEALTHCHECK via module state, never via files.
 */
let cachedCredentials: DockerHealthCredentials | null = null;

export function createDockerHealthCredentials(
  now = new Date(),
): DockerHealthCredentials {
  cachedCredentials = {
    username: DOCKER_HEALTH_USERNAME,
    password: generateDockerHealthPassword(),
    createdAt: now.toISOString(),
  };

  return cachedCredentials;
}

export function getDockerHealthCredentials(): DockerHealthCredentials | null {
  return cachedCredentials;
}

export function setDockerHealthCredentialsForTests(
  credentials: DockerHealthCredentials | null,
): void {
  cachedCredentials = credentials;
}
