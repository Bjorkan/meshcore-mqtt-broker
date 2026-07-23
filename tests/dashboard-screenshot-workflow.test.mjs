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

  assert.match(capture, /Latest neighbor snapshot/);
  assert.match(capture, /openClickableRowByText\(page, "Stockholm Rooftop"\)/);
  assert.match(capture, /neighbor query result visible/);
  assert.match(capture, /mobile neighbor query result visible/);
  assert.match(
    capture,
    /assertDialogIntegrity\(page, "mobile observer modal"\)/,
  );
  assert.match(capture, /assertDialogIntegrity/);
});

test("dashboard screenshot review targets Astryx controls semantically", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");

  assert.match(capture, /page\.getByRole\("dialog"\)/);
  assert.match(capture, /page\.getByLabel\("Public key"\)/);
  assert.match(capture, /a\[href\]/);
  assert.match(capture, /const minimumTargetSize = 24/);
  assert.match(
    capture,
    /rect\.height < minimumTargetSize \|\|\s+rect\.width < minimumTargetSize/,
  );
  assert.doesNotMatch(capture, /\[role=["']dialog/);
  assert.match(capture, /view did not start at the top/);
  assert.match(capture, /globalThis\.scrollY/);
});

test("dashboard screenshot review uses stable responsive record selectors", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");

  assert.match(
    capture,
    /const dashboardRecordSelector = '\[data-dashboard-record="true"\]'/,
  );
  assert.match(capture, /data-record-interactive="true"/);
  assert.match(capture, /dashboardRecordSelector}:has\(button\)/);
  assert.match(capture, /data-record-kind/);
  assert.match(capture, /async function assertRecordArchitecture/);
  assert.match(capture, /record\.tag === "TR" && record\.inTable/);
  assert.match(capture, /record\.tag === "LI" && record\.inList/);
  assert.match(capture, /"desktop MeshCore\.io workers"/);
  assert.match(capture, /"mobile MeshCore\.io uploads"/);
  assert.doesNotMatch(capture, /table tbody/);
  assert.doesNotMatch(capture, /\.row-action/);
});

test("dashboard screenshot review covers the required viewport matrix", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");

  for (const label of [
    "320px mobile",
    "360px mobile",
    "390px mobile",
    "430px mobile",
    "short mobile",
    "768px tablet",
    "1024px desktop",
    "1280px desktop",
    "1440px desktop",
    "1920px desktop",
  ]) {
    assert.match(capture, new RegExp(label));
  }
});
