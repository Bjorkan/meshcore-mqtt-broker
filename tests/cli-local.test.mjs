import assert from "node:assert/strict";
import { spyOn, test } from "bun:test";
import { runCli } from "../src/cli.js";

test("CLI status queries the live broker instead of fabricating identity", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("offline"),
  );
  try {
    // An unreachable broker must report not-running,
    // never a fabricated Broker-XXXX + now-as-start-time.
    assert.equal(await runCli(["status"]), 0);
    const output = log.mock.calls.flat().join("\n");
    assert.match(output, /stateless/);
    assert.match(output, /kör inte/);
    assert.doesNotMatch(output, /Broker-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}/);
  } finally {
    fetchSpy.mockRestore();
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

test.each([
  ["observer", "list"],
  ["abuse", "list"],
  ["reset", "--force"],
  ["status", "--database=/tmp/other.db"],
  ["status", "--unknown"],
  ["status", "extra"],
])("CLI rejects unsupported commands and arguments: %j", async (...argv) => {
  await assert.rejects(runCli(argv), /Okänt kommando eller argument/);
});

test("CLI status prints the live broker identity, uptime and observer count", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      status: "ok",
      storage: "stateless",
      instanceId: "Test-ABCD",
      uptimeMs: 12000,
      observers: 4,
    }),
  );
  try {
    assert.equal(await runCli(["status"]), 0);
    const output = log.mock.calls.flat().join("\n");
    assert.match(output, /Broker: Test-ABCD/);
    assert.match(output, /Uptime: 12s/);
    assert.match(output, /Observatörer: 4/);
  } finally {
    fetchSpy.mockRestore();
    log.mockRestore();
  }
});
