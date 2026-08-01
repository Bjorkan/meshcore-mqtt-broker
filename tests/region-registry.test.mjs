import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { RegionRegistry } from "../dist/region-registry.js";

function regionConfig(whitelistEnabled = true) {
  return {
    whitelistEnabled,
    allowedPrimaryRegions: whitelistEnabled ? ["MMX", "STO"] : [],
    primaryEntries: whitelistEnabled
      ? {
          MMX: {
            code: "MMX",
            friendlyName: "Southern region",
            secondaryRegions: ["AGH", "KID"],
          },
          STO: { code: "STO", secondaryRegions: [] },
        }
      : {},
    secondaryEntries: whitelistEnabled
      ? {
          AGH: { code: "AGH", primaryRegion: "MMX" },
          KID: { code: "KID", primaryRegion: "MMX" },
        }
      : {},
  };
}

test("disabled whitelist passes valid regions without configured corrections", () => {
  const registry = new RegionRegistry(regionConfig(false));
  assert.equal(registry.isWhitelistEnabled(), false);
  assert.equal(registry.isAllowedRegion("abc"), true);
  assert.equal(registry.isAllowedRegion("AB12"), false);
  assert.equal(registry.isSecondaryRegion("AGH"), false);
  assert.equal(registry.getPrimaryRegion("AGH"), undefined);
  assert.equal(registry.getCorrection("AGH"), undefined);
  assert.deepEqual(registry.getPublicLookup(), {});
});

test("enabled registry exposes primary and secondary relationships", () => {
  const registry = new RegionRegistry(regionConfig());
  assert.equal(registry.isAllowedRegion("mmx"), true);
  assert.equal(registry.isAllowedRegion("AGH"), false);
  assert.equal(registry.isSecondaryRegion(" agh "), true);
  assert.equal(registry.getPrimaryRegion("AGH"), "MMX");
  assert.equal(registry.getPrimaryRegion("STO"), "STO");
  assert.equal(registry.getPrimaryRegion("XXX"), undefined);
  assert.equal(registry.getFriendlyName("MMX"), "Southern region");
  assert.equal(registry.getFriendlyName("AGH"), "Southern region");
  assert.equal(registry.getFriendlyName("STO"), undefined);
});

test("correction text includes a configured friendly name when available", () => {
  const registry = new RegionRegistry(regionConfig());
  assert.equal(
    registry.getCorrection("AGH"),
    "Region AGH is a secondary code. Use MMX (Southern region).",
  );
  assert.equal(registry.getCorrection("STO"), undefined);
  assert.equal(registry.getCorrection("XXX"), undefined);
});

test("correction text works without a friendly name", () => {
  const value = regionConfig();
  value.primaryEntries.MMX.friendlyName = undefined;
  assert.equal(
    new RegionRegistry(value).getCorrection("KID"),
    "Region KID is a secondary code. Use MMX.",
  );
});

test("public lookup identifies allowed primaries and disallowed secondaries", () => {
  const lookup = new RegionRegistry(regionConfig()).getPublicLookup();
  assert.deepEqual(lookup.MMX, {
    friendlyName: "Southern region",
    primaryRegion: "MMX",
    isPrimary: true,
    isAllowed: true,
  });
  assert.deepEqual(lookup.AGH, {
    friendlyName: "Southern region",
    primaryRegion: "MMX",
    isPrimary: false,
    isAllowed: false,
  });
});

test("construction performs no filesystem or HTTP work", () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error("unexpected fetch");
  };
  try {
    const registry = new RegionRegistry(regionConfig());
    assert.equal(registry.isAllowedRegion("MMX"), true);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
