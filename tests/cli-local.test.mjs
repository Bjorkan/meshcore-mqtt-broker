import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";
import { runCli } from "../dist/cli.js";
import { temporaryDatabase } from "./test-database.mjs";

const fixtures = [];
afterEach(async () => {
  while (fixtures.length) await fixtures.pop().cleanup();
});

test("CLI rejects production database path overrides", async () => {
  await assert.rejects(runCli(["status", "--database=/tmp/other.db"]), /fast/);
});

test("CLI status probes Turso and reset requires confirmation", async () => {
  const fixture = await temporaryDatabase("cli-");
  fixtures.push(fixture);
  await fixture.database.run(
    "INSERT INTO observer_profiles(public_key, node_name) VALUES (?, ?)",
    "A".repeat(64),
    "test",
  );
  await fixture.database.run(
    "INSERT INTO target_retained_clears(topic, expires_at_ms) VALUES (?, ?)",
    "meshcore/test/key/neighbors",
    Date.now(),
  );
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  assert.equal(await runCli(["status"], { database: fixture.database }), 0);
  assert.match(log.mock.calls.flat().join("\n"), /Turso: tillgänglig/);
  assert.equal(
    await runCli(["reset"], {
      database: fixture.database,
      confirmReset: async () => false,
    }),
    0,
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM observer_profiles",
        )
      ).count,
    ),
    1,
  );
  assert.equal(
    await runCli(["reset", "--force"], { database: fixture.database }),
    0,
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM observer_profiles",
        )
      ).count,
    ),
    0,
  );
  assert.equal(
    Number(
      (
        await fixture.database.get(
          "SELECT COUNT(*) AS count FROM target_retained_clears",
        )
      ).count,
    ),
    0,
  );
});
