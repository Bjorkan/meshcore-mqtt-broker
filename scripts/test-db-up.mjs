#!/usr/bin/env bun
// Starts the disposable PostgreSQL test database from compose.test.yaml.
import { spawnSync } from "node:child_process";

const compose = [
  "compose",
  "-f",
  new URL("../compose.test.yaml", import.meta.url).pathname,
  "-p",
  "meshcore-mqtt-broker-test",
];

const result = spawnSync("docker", [...compose, "up", "--wait", "--detach"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
