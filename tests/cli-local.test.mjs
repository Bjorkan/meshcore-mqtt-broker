import assert from "node:assert/strict";
import { afterEach, spyOn, test } from "bun:test";
import { runCli } from "../src/cli.js";

afterEach(() => {});

test("CLI rejects production database path overrides", async () => {
  await assert.rejects(runCli(["status", "--database=/tmp/other.db"]), /fast/);
});

test("CLI status reports the stateless broker identity", async () => {
  const log = spyOn(console, "log").mockImplementation(() => undefined);
  try {
    assert.equal(await runCli(["status"]), 0);
    assert.match(log.mock.calls.flat().join("\n"), /stateless/);
  } finally {
    log.mockRestore();
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
