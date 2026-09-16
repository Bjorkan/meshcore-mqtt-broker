import assert from "node:assert/strict";
import { afterEach, spyOn, test } from "bun:test";
import { runCli } from "../src/cli.js";

afterEach(() => {});

test("CLI rejects production database path overrides", async () => {
  await assert.rejects(runCli(["status", "--database=/tmp/other.db"]), /fast/);
});

test("CLI status queries the live broker instead of fabricating identity", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    // No broker running in the test process: must report not-running,
    // never a fabricated Broker-XXXX + now-as-start-time.
    assert.equal(await runCli(["status"]), 0);
    const output = log.mock.calls.flat().join("\n");
    assert.match(output, /stateless/);
    assert.match(output, /kör inte/);
    assert.doesNotMatch(output, /Broker-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}/);
  } finally {
    log.mockRestore();
  }
});

test("CLI rejects v1_-prefixed subscriber names at config load", async () => {
  const {
    setConfigDocumentForTests,
    resetConfigCacheForTests,
    loadSubscriberConfig,
  } = await import("../src/config.js");
  const exit = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    setConfigDocumentForTests({
      subscribers: {
        default_max_connections: 1,
        users: [{ username: "v1_abc", password: "x" }],
      },
    });
    assert.throws(() => loadSubscriberConfig(), /process\.exit/);
    assert.match(error.mock.calls.flat().join("\n"), /v1_/);
  } finally {
    exit.mockRestore();
    error.mockRestore();
    resetConfigCacheForTests();
  }
});

test("CLI observer list explains process-local state", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    assert.equal(await runCli(["observer", "list"]), 0);
    assert.match(log.mock.calls.flat().join("\n"), /processlokal|tomt/i);
  } finally {
    log.mockRestore();
  }
});

test("CLI abuse command explains observe-only mode", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    assert.equal(await runCli(["abuse", "list"]), 0);
    assert.match(log.mock.calls.flat().join("\n"), /observe-only/);
  } finally {
    log.mockRestore();
  }
});

test("CLI reset is a stateless no-op after confirmation", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    assert.equal(
      await runCli(["reset", "--force"], {
        confirmReset: async () => true,
      }),
      0,
    );
    assert.match(log.mock.calls.flat().join("\n"), /stateless/);
  } finally {
    log.mockRestore();
  }
});
