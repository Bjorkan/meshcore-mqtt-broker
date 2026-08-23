import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  normalizeRegionScope,
  regionScopeCountyCount,
  regionScopeEntry,
  regionScopeMunicipalityCount,
  regionScopeName,
} from "../dist/region-scopes.js";

test("normalizes Swedish region scopes to canonical lowercase", () => {
  assert.equal(normalizeRegionScope("se"), "se");
  assert.equal(normalizeRegionScope("SE"), "se");
  assert.equal(normalizeRegionScope(" Se "), "se");
  assert.equal(normalizeRegionScope("se13"), "se13");
  assert.equal(normalizeRegionScope("SE13"), "se13");
  assert.equal(normalizeRegionScope("Se1388"), "se1388");
  assert.equal(normalizeRegionScope(" SE0680 "), "se0680");
});

test("preserves unknown and non-Swedish scopes after trimming", () => {
  assert.equal(normalizeRegionScope("Europe"), "Europe");
  assert.equal(normalizeRegionScope(" UK "), "UK");
  assert.equal(normalizeRegionScope("*"), "*");
  assert.equal(normalizeRegionScope("public"), "public");
  assert.equal(normalizeRegionScope("se99"), "se99");
  assert.equal(normalizeRegionScope("se9999"), "se9999");
  assert.equal(normalizeRegionScope("seabc"), "seabc");
});

test("resolves administrative names for known Swedish codes only", () => {
  assert.equal(regionScopeName("se"), "Sverige");
  assert.equal(regionScopeName("SE06"), "Jönköpings län");
  assert.equal(regionScopeName("se0680"), "Jönköping");
  assert.equal(regionScopeName("se1380"), "Halmstad");
  assert.equal(regionScopeName("se25"), "Norrbottens län");
  assert.equal(regionScopeName("se2584"), "Kiruna");
  assert.equal(regionScopeName("se99"), null);
  assert.equal(regionScopeName("public"), null);
});

test("scope entries keep the name on a separate field and fall back to the scope", () => {
  assert.deepEqual(regionScopeEntry("SE1380"), {
    scope: "se1380",
    name: "Halmstad",
  });
  assert.deepEqual(regionScopeEntry("SE06"), {
    scope: "se06",
    name: "Jönköpings län",
  });
  assert.deepEqual(regionScopeEntry("Europe"), {
    scope: "Europe",
    name: "Europe",
  });
  assert.deepEqual(regionScopeEntry("SE"), { scope: "se", name: "Sverige" });
  assert.deepEqual(regionScopeEntry("se9999"), {
    scope: "se9999",
    name: "se9999",
  });
});

test("registry covers Sweden, every county, and every municipality", () => {
  assert.equal(regionScopeCountyCount(), 21);
  assert.equal(regionScopeMunicipalityCount(), 290);
});
