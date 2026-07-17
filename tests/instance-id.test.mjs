import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@jest/globals";

import { resolveBrokerInstanceId } from "../dist/instance-id.js";

test("persistent broker instance id is reused across restarts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "meshcore-instance-id-test-"));
  const runtimeIdFile = join(tempDir, "broker-id");

  try {
    const first = resolveBrokerInstanceId({
      persist: true,
      brokerName: "Broker",
      runtimeIdFile,
    });
    const second = resolveBrokerInstanceId({
      persist: true,
      brokerName: "Broker",
      runtimeIdFile,
    });

    assert.equal(second, first);
    assert.equal(readFileSync(runtimeIdFile, "utf8"), `${first}\n`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persistent broker instance id preserves an existing runtime file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "meshcore-instance-id-test-"));
  const runtimeIdFile = join(tempDir, "broker-id");

  try {
    writeFileSync(runtimeIdFile, "Broker-ABCD\n");
    assert.equal(
      resolveBrokerInstanceId({ persist: true, runtimeIdFile }),
      "Broker-ABCD",
    );
    assert.equal(readFileSync(runtimeIdFile, "utf8"), "Broker-ABCD\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
