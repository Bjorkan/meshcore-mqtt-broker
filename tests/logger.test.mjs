import assert from "node:assert/strict";
import { spyOn, test } from "bun:test";
import { getModuleLogger } from "../src/logger.js";

function captureLog(callback) {
  const calls = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    calls.push(args.join(" "));
  });
  try {
    callback();
  } finally {
    spy.mockRestore();
  }
  return calls.join(" ");
}

test("logger strips control characters from interpolated values", () => {
  const text = captureLog(() => {
    const log = getModuleLogger("sanitize-test");
    log.info("publish denied for", {
      nodeName: "alice\n2026-01-01 00:00:00 INFO forged entry",
      topic: "meshcore/TEST/key/status\r\nEVIL",
    });
  });
  assert.ok(!/[\r\n]forged/.test(text), "raw newline leaked into log output");
  assert.ok(text.includes("alice\\\\n"), "newline not escaped in object value");
  assert.ok(text.includes("\\\\r\\\\nEVIL"), "topic control chars not escaped");
});

test("logger escapes newlines in top-level strings and error objects", () => {
  const text = captureLog(() => {
    const log = getModuleLogger("sanitize-top");
    log.info(
      "observer alice\n2026-01-01 00:00:00 ERROR FakeModule forged connected",
    );
    log.error("decode failed", new Error("bad packet\nforged line"));
  });
  assert.ok(!/[\r\n]forged/.test(text), "raw newline leaked into log output");
  assert.ok(text.includes("alice\\n2026"), "top-level newline not escaped");
  assert.ok(text.includes("packet\\nforged line"), "error newline not escaped");
});
