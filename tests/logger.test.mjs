import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { getModuleLogger } from "../dist/logger.js";

test("logger strips control characters from interpolated values", () => {
  const calls = [];
  const spy = jest.spyOn(console, "log").mockImplementation((...args) => {
    calls.push(args.join(" "));
  });
  const log = getModuleLogger("sanitize-test");
  log.info("publish denied for", {
    nodeName: "alice\n2026-01-01 00:00:00 INFO forged entry",
    topic: "meshcore/TEST/key/status\r\nEVIL",
  });
  spy.mockRestore();
  const text = calls.join(" ");
  assert.ok(!/[\r\n]forged/.test(text), "raw newline leaked into log output");
  assert.ok(
    text.includes("alice\\n2026-01-01"),
    "newline not escaped as literal text",
  );
  assert.ok(text.includes("\\r\\nEVIL"), "topic control chars not escaped");
});
