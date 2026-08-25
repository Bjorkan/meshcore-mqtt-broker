import { spawnSync } from "node:child_process";

const compose = [
  "compose",
  "-f",
  "compose.test.yaml",
  "-p",
  "meshcore-mqtt-broker-test",
];
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

let attemptedStart = false;
try {
  attemptedStart = true;
  if (run("docker", [...compose, "up", "--wait", "--detach"]) !== 0)
    process.exitCode = 1;
  else {
    const status = run("bun", ["run", "test:postgres"], {
      env: {
        ...process.env,
        POSTGRES_TEST_URL:
          "postgresql://meshcore_test:meshcore_test@127.0.0.1:55432/meshcore_test",
      },
    });
    if (status !== 0) process.exitCode = status;
  }
} finally {
  if (attemptedStart) run("docker", [...compose, "down", "--volumes"]);
}
