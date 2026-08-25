import assert from "node:assert/strict";
import { test } from "bun:test";
import { IataRegistry } from "../src/iata-registry.js";

function iataConfig(allowlistEnabled = true) {
  return {
    allowlistEnabled,
    allowTestIngress: false,
    allowedPrimaryIata: allowlistEnabled ? ["MMX", "STO"] : [],
    primaryEntries: allowlistEnabled
      ? {
          MMX: {
            code: "MMX",
            friendlyName: "Southern IATA area",
            secondaryIata: ["AGH", "KID"],
          },
          STO: { code: "STO", secondaryIata: [] },
        }
      : {},
    secondaryEntries: allowlistEnabled
      ? {
          AGH: { code: "AGH", primaryIata: "MMX" },
          KID: { code: "KID", primaryIata: "MMX" },
        }
      : {},
  };
}

test("registry never accepts unconfigured IATA even if given legacy disabled state", () => {
  const registry = new IataRegistry(iataConfig(false));
  assert.equal(registry.isAllowlistEnabled(), false);
  assert.equal(registry.isAllowedIata("abc"), false);
  assert.equal(registry.isAllowedIata("AB12"), false);
  assert.equal(registry.isSecondaryIata("AGH"), false);
  assert.equal(registry.getPrimaryIata("AGH"), undefined);
  assert.equal(registry.getCorrection("AGH"), undefined);
  assert.deepEqual(registry.getPublicLookup(), {});
});

test("enabled registry exposes primary and secondary IATA relationships", () => {
  const registry = new IataRegistry(iataConfig());
  assert.equal(registry.isAllowedIata("mmx"), true);
  assert.equal(registry.isAllowedIata("AGH"), false);
  assert.equal(registry.isSecondaryIata(" agh "), true);
  assert.equal(registry.getPrimaryIata("AGH"), "MMX");
  assert.equal(registry.getPrimaryIata("STO"), "STO");
  assert.equal(registry.getPrimaryIata("XXX"), undefined);
  assert.equal(registry.getFriendlyName("MMX"), "Southern IATA area");
  assert.equal(registry.getFriendlyName("AGH"), "Southern IATA area");
  assert.equal(registry.getFriendlyName("STO"), undefined);
});

test("correction text includes a configured friendly name when available", () => {
  const registry = new IataRegistry(iataConfig());
  assert.equal(
    registry.getCorrection("AGH"),
    "IATA AGH is a secondary code. Use MMX (Southern IATA area).",
  );
  assert.equal(registry.getCorrection("STO"), undefined);
  assert.equal(registry.getCorrection("XXX"), undefined);
});

test("correction text works without a friendly name", () => {
  const value = iataConfig();
  value.primaryEntries.MMX.friendlyName = undefined;
  assert.equal(
    new IataRegistry(value).getCorrection("KID"),
    "IATA KID is a secondary code. Use MMX.",
  );
});

test("public lookup identifies allowed primaries and disallowed secondaries", () => {
  const lookup = new IataRegistry(iataConfig()).getPublicLookup();
  assert.deepEqual(lookup.MMX, {
    friendlyName: "Southern IATA area",
    primaryIata: "MMX",
    isPrimary: true,
    isAllowed: true,
  });
  assert.deepEqual(lookup.AGH, {
    friendlyName: "Southern IATA area",
    primaryIata: "MMX",
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
    const registry = new IataRegistry(iataConfig());
    assert.equal(registry.isAllowedIata("MMX"), true);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
