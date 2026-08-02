import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "@jest/globals";
import { DashboardState, renderDashboardHtml } from "../dist/dashboard.js";
import { RegionRegistry } from "../dist/region-registry.js";

test("neutral dashboard HTML contains no operator-specific branding", () => {
  const html = renderDashboardHtml({ instanceId: "test" });
  assert.match(html, /<title>MeshCore MQTT Broker<\/title>/);
  assert.match(html, /"operatorName":"MeshCore MQTT"/);
  assert.equal(new RegExp(["mesh", "at"].join(""), "i").test(html), false);
});

test("configured public branding and whitelist status are embedded", () => {
  const html = renderDashboardHtml({
    instanceId: "test",
    publicDashboardConfig: {
      branding: {
        operatorName: "Community Mesh",
        dashboardTitle: "Community Broker",
        dashboardSubtitle: "Network operations",
        websiteUrl: "https://example.org/",
      },
      iataWhitelistEnabled: true,
    },
  });
  assert.match(html, /<title>Community Broker<\/title>/);
  assert.match(html, /"operatorName":"Community Mesh"/);
  assert.match(html, /"websiteUrl":"https:\/\/example\.org\/"/);
  assert.match(html, /"iataWhitelistEnabled":true/);
});

test("dashboard bootstrap escapes script injection and excludes extra settings", () => {
  const publicDashboardConfig = {
    branding: {
      operatorName: "</script><script>alert(1)</script>",
      dashboardTitle: "</title><script>alert(2)</script>",
      dashboardSubtitle: "A&B",
    },
    iataWhitelistEnabled: false,
    subscribers: { users: [{ password: "private-password" }] },
    target_mqtt: { password: "private-target-password" },
  };
  const html = renderDashboardHtml({
    instanceId: "test",
    publicDashboardConfig,
  });
  assert.equal(html.includes("</script><script>alert(1)"), false);
  assert.equal(html.includes("</title><script>alert(2)"), false);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;/);
  assert.equal(html.includes("private-password"), false);
  assert.equal(html.includes("private-target-password"), false);
});

test("favicon label and map providers remain neutral and hard-coded", () => {
  const dashboardSource = readFileSync(
    new URL("../src/dashboard.ts", import.meta.url),
    "utf-8",
  );
  const clientSource = readFileSync(
    new URL("../src/dashboard-client.tsx", import.meta.url),
    "utf-8",
  );
  assert.match(dashboardSource, /MeshCore MQTT Broker radio tower favicon/);
  assert.match(clientSource, /https:\/\/tile\.openstreetmap\.org/);
  assert.match(clientSource, /https:\/\/basemaps\.cartocdn\.com\/dark_all/);
  assert.match(clientSource, /OpenStreetMap contributors/);
  assert.match(clientSource, /CARTO/);
  assert.equal(/api[_-]?key/i.test(clientSource), false);
});

test("regionLookup is canonical while countyLookup remains only as deprecated API alias", () => {
  const dashboardSource = readFileSync(
    new URL("../src/dashboard.ts", import.meta.url),
    "utf-8",
  );
  const clientSource = readFileSync(
    new URL("../src/dashboard-client.tsx", import.meta.url),
    "utf-8",
  );
  assert.match(dashboardSource, /@deprecated Use regionLookup/);
  assert.match(clientSource, /regionLookup/);
  assert.equal(clientSource.includes("countyLookup"), false);
});

function dashboardStore() {
  let metrics = [];
  return {
    async setBrokerMetrics(value) {
      metrics = [value];
    },
    async setObserverEntries() {},
    listBrokerMetrics() {
      return metrics;
    },
    async listPublicBans() {
      return [];
    },
    async listDeniedPublishes() {
      return [];
    },
    async listObservers() {
      return [];
    },
    async countBlockedObservers() {
      return { mutedBans: 0, deniedPublishes: 0 };
    },
    async getObserverNodeNames() {
      return new Map();
    },
    async listSubscriberConnections() {
      return [];
    },
  };
}

test("dashboard snapshot returns empty canonical and compatibility lookups when inactive", async () => {
  const regionRegistry = new RegionRegistry({
    whitelistEnabled: false,
    allowedPrimaryRegions: [],
    primaryEntries: {},
    secondaryEntries: {},
  });
  const state = new DashboardState({ instanceId: "test", regionRegistry });
  const snapshot = await state.getSnapshot(dashboardStore(), 0);
  assert.deepEqual(snapshot.regionLookup, {});
  assert.deepEqual(snapshot.countyLookup, {});
});

test("compatibility lookup keeps a string name for list-form primaries", async () => {
  const regionRegistry = new RegionRegistry({
    whitelistEnabled: true,
    allowedPrimaryRegions: ["STO"],
    primaryEntries: {
      STO: { code: "STO", secondaryRegions: [] },
    },
    secondaryEntries: {},
  });
  const state = new DashboardState({ instanceId: "test", regionRegistry });
  const snapshot = await state.getSnapshot(dashboardStore(), 0);
  assert.deepEqual(snapshot.countyLookup.STO, {
    countyName: "STO",
    primaryIata: "STO",
    isPrimary: true,
  });
});
