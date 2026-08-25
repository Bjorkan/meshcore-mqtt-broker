#!/usr/bin/env bun
// Stops the disposable PostgreSQL test database and removes its volumes,
// even after failed test runs.
import { spawnSync } from "node:child_process";

const compose = [
  "compose",
  "-f",
  new URL("../compose.test.yaml", import.meta.url).pathname,
  "-p",
  "meshcore-mqtt-broker-test",
];

const down = spawnSync(
  "docker",
  [...compose, "down", "--volumes", "--remove-orphans"],
  {
    stdio: "inherit",
  },
);
process.exit(down.status ?? 1);
