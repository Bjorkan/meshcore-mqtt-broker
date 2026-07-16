import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "@jest/globals";

function runChild(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

test("Valkey MQ emitter connection errors are handled instead of crashing Node", async () => {
  const result = await runChild(`
    import { createOrchestrationRuntime } from "./dist/orchestration.js";

    const runtime = createOrchestrationRuntime({
      kvUrl: "redis://127.0.0.1:1",
      namespace: "meshcore-orchestration-error-test",
      instanceId: "Broker-ERROR",
      backgroundRefresh: false,
    });

    const mq = runtime.aedesOptions.mq;
    if (mq.pubConn.options.connectTimeout !== 5000 || mq.pubConn.options.commandTimeout !== 5000) {
      throw new Error("MQ emitter publisher connection is missing bounded Valkey timeouts");
    }
    if (mq.subConn.options.connectTimeout !== 5000 || mq.subConn.options.commandTimeout !== 5000) {
      throw new Error("MQ emitter subscriber connection is missing bounded Valkey timeouts");
    }

    setTimeout(() => {
      const closeTimeout = setTimeout(() => {
        throw new Error("MQ emitter close callback did not complete");
      }, 1000);

      mq.close(() => {
        clearTimeout(closeTimeout);
        process.exit(0);
      });
    }, 300);
  `);

  assert.equal(
    result.code,
    0,
    `child exited unexpectedly${result.signal ? ` from ${result.signal}` : ""}:\n${result.stderr}`,
  );
});
