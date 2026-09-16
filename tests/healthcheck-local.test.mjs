import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  createDockerHealthCredentials,
  DOCKER_HEALTH_USERNAME,
  generateDockerHealthPassword,
} from "../src/docker-health-user.js";

test("healthcheck credential helper keeps username and password shape", () => {
  const creds = createDockerHealthCredentials();
  assert.equal(creds.username, DOCKER_HEALTH_USERNAME);
  assert.equal(typeof creds.password, "string");
  assert.equal(creds.password.length, 32);
  assert.ok(generateDockerHealthPassword());
});
