import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "@jest/globals";

const root = process.cwd();
const text = (file) => readFile(path.join(root, file), "utf8");

test("dashboard screenshots use only an explicit embedded test database", async () => {
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");
  const workflow = await text(".github/workflows/dashboard-screenshots.yml");

  assert.match(capture, /openTestDatabase\(/);
  assert.match(capture, /new BrokerStateStore\(/);
  assert.match(capture, /createDashboardServer\(/);
  assert.doesNotMatch(capture, /\/data\/meshcore-mqtt-broker|config\.yaml/i);
  assert.doesNotMatch(workflow, /services:|valkey|redis|dist\/server\.js/i);
});

test("dashboard screenshot command captures desktop, mobile, and both themes", async () => {
  const pkg = JSON.parse(await text("package.json"));
  const capture = await text("scripts/capture-dashboard-screenshots.mjs");

  assert.equal(
    pkg.scripts["dashboard:screenshots"],
    "npm run build && node scripts/capture-dashboard-screenshots.mjs",
  );
  for (const screenshot of [
    "desktop-01-overview-light",
    "desktop-02-overview-dark",
    "desktop-10-meshcoreio",
    "mobile-01-overview",
    "mobile-02-navigation",
    "mobile-07-meshcoreio",
  ]) {
    assert.match(capture, new RegExp(screenshot));
  }
});

test("PR screenshot workflow uploads artifacts and maintains one report comment", async () => {
  const workflow = await text(".github/workflows/dashboard-screenshots.yml");

  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /npm run dashboard:screenshots/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /dashboard-screenshots\/files\.txt/);
  assert.match(workflow, /<!-- dashboard-screenshots-report -->/);
  assert.match(workflow, /issues\.updateComment/);
  assert.match(workflow, /issues\.createComment/);
});
