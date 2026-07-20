import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "@jest/globals";

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("PR screenshot workflow captures the Meshcore.io view on desktop and mobile", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");
  const workflow = await text(".github/workflows/dashboard-screenshots.yml");

  assert.match(capture, /openView\(page, "meshcoreio"\)/);
  assert.match(capture, /desktop-13-meshcoreio/);
  assert.match(capture, /mobile-13-meshcoreio/);
  assert.match(workflow, /desktop-13-meshcoreio\.png/);
  assert.match(workflow, /mobile-13-meshcoreio\.png/);
});

test("PR screenshot workflow enables safe Meshcore.io demo mode", async () => {
  const workflow = await text(".github/workflows/dashboard-screenshots.yml");
  const seed = await text("scripts/seed-dashboard-demo.mjs");

  assert.match(workflow, /meshcore_io:\s+enabled: true/s);
  assert.match(workflow, /dry_run: true/);
  assert.match(
    workflow,
    /npm run dashboard:seed-demo\s+node dist\/server\.js/s,
  );
  assert.match(seed, /Seeded MeshCore\.io dashboard data/);
  assert.match(seed, /ReviewBroker-STO/);
  assert.match(seed, /Vasastan Rooftop/);
});

test("dashboard screenshot review covers neighbor snapshots and modal overflow", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");
  const styles = await text("src/dashboard-styles.ts");

  assert.match(capture, /Latest neighbor snapshot/);
  assert.match(capture, /openClickableRowByText\(page, "Stockholm Rooftop"\)/);
  assert.match(capture, /neighbor query result visible/);
  assert.match(capture, /mobile neighbor query result visible/);
  assert.match(
    capture,
    /assertDialogIntegrity\(page, "mobile observer modal"\)/,
  );
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
});
