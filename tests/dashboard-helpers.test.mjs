import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "@jest/globals";
import {
  formatDeniedUntilLabel,
  formatRegionDisplay,
  formatRegionOptionLabel,
} from "../dist/dashboard-helpers.js";

test('formatDeniedUntilLabel: would_mute returns "-"', () => {
  assert.equal(formatDeniedUntilLabel({ status: "would_mute" }), "-");
  assert.equal(
    formatDeniedUntilLabel({ status: "would_mute", deniedUntilText: "något" }),
    "-",
  );
  assert.equal(
    formatDeniedUntilLabel({ status: "would_mute", mutedUntil: 123456 }),
    "-",
  );
});

test("formatDeniedUntilLabel: deniedUntilText shown when present", () => {
  const result = formatDeniedUntilLabel({
    status: "denied",
    deniedUntilText: "Tills observer byter till korrekt IATA MMX för Skåne län",
  });
  assert.equal(
    result,
    "Tills observer byter till korrekt IATA MMX för Skåne län",
  );
});

test("formatDeniedUntilLabel: mutedUntil shown when deniedUntilText absent", () => {
  const result = formatDeniedUntilLabel({
    status: "muted",
    mutedUntil: 2000000000000,
  });
  assert.ok(result.length > 8);
  assert.ok(result.match(/^\d/));
});

test('formatDeniedUntilLabel: "-" when nothing available', () => {
  assert.equal(formatDeniedUntilLabel({ status: "denied" }), "-");
  assert.equal(formatDeniedUntilLabel({ status: "muted" }), "-");
});

test('formatDeniedUntilLabel: "-" for unknown status', () => {
  assert.equal(formatDeniedUntilLabel({ status: "unknown" }), "-");
});

test("formatRegionDisplay: null for undefined region", () => {
  assert.equal(formatRegionDisplay(undefined, {}), null);
  assert.equal(formatRegionDisplay(undefined), null);
});

test("formatRegionDisplay: just code when no lookup", () => {
  const result = formatRegionDisplay("STO");
  assert.deepEqual(result, { code: "STO" });
});

test("formatRegionDisplay: just code when lookup empty", () => {
  const result = formatRegionDisplay("STO", {});
  assert.deepEqual(result, { code: "STO" });
});

test("formatRegionDisplay: code only when region not in lookup", () => {
  const result = formatRegionDisplay("XXX", {
    STO: { countyName: "Stockholm", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { code: "XXX" });
});

test("formatRegionDisplay: county name and code when lookup available", () => {
  const result = formatRegionDisplay("STO", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { countyName: "Stockholms län", code: "STO" });
});

test("formatRegionDisplay: secondary IATA shows its own code, not primary", () => {
  const result = formatRegionDisplay("ARN", {
    ARN: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: false },
  });
  assert.deepEqual(result, { countyName: "Stockholms län", code: "ARN" });
});

test("formatRegionDisplay: normalizes lowercase IATA input", () => {
  const result = formatRegionDisplay("sto", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { countyName: "Stockholms län", code: "STO" });
});

test("formatRegionDisplay: normalizes whitespace in IATA input", () => {
  const result = formatRegionDisplay(" STO ", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { countyName: "Stockholms län", code: "STO" });
});

test("formatRegionDisplay: test region stays as test, never uppercased", () => {
  const result = formatRegionDisplay("test", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { code: "test" });
});

test("formatRegionDisplay: whitespace test normalized to test", () => {
  assert.deepEqual(formatRegionDisplay(" test ", {}), { code: "test" });
});

test("formatRegionDisplay: uppercase TEST normalized to test", () => {
  assert.deepEqual(formatRegionDisplay("TEST", {}), { code: "test" });
});

test("formatRegionDisplay: blank region returns null", () => {
  assert.equal(formatRegionDisplay("   ", {}), null);
  assert.equal(formatRegionDisplay("", {}), null);
});

test("formatRegionDisplay: unknown region returns normalized code", () => {
  const result = formatRegionDisplay(" xxx ", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.deepEqual(result, { code: "XXX" });
});

test("formatRegionOptionLabel: county name and code with lookup", () => {
  const result = formatRegionOptionLabel("STO", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.equal(result, "Stockholms län (STO)");
});

test("formatRegionOptionLabel: just code when no lookup", () => {
  const result = formatRegionOptionLabel("STO");
  assert.equal(result, "STO");
});

test("formatRegionOptionLabel: just code when region not in lookup", () => {
  const result = formatRegionOptionLabel("XXX", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.equal(result, "XXX");
});

test("formatRegionOptionLabel: uses normalized code in label", () => {
  const result = formatRegionOptionLabel("sto", {
    STO: { countyName: "Stockholms län", primaryIata: "STO", isPrimary: true },
  });
  assert.equal(result, "Stockholms län (STO)");
});

test("formatRegionOptionLabel: whitespace test returns test", () => {
  assert.equal(formatRegionOptionLabel(" test ", {}), "test");
});

test("formatRegionOptionLabel: blank region returns dash", () => {
  assert.equal(formatRegionOptionLabel("   ", {}), "-");
});

test('formatDeniedUntilLabel: unknown status with deniedUntilText returns "-"', () => {
  assert.equal(
    formatDeniedUntilLabel({ status: "unknown", deniedUntilText: "något" }),
    "-",
  );
});

test('formatDeniedUntilLabel: unknown status with mutedUntil returns "-"', () => {
  assert.equal(
    formatDeniedUntilLabel({ status: "unknown", mutedUntil: 2000000000000 }),
    "-",
  );
});

test("formatDeniedUntilLabel: denied status with deniedUntilText shows text", () => {
  const result = formatDeniedUntilLabel({
    status: "denied",
    deniedUntilText: "Korrigera IATA",
  });
  assert.equal(result, "Korrigera IATA");
});

test("formatDeniedUntilLabel: muted status with mutedUntil shows time", () => {
  const result = formatDeniedUntilLabel({
    status: "muted",
    mutedUntil: 2000000000000,
  });
  assert.ok(result.length > 8);
  assert.ok(result.match(/^\d/));
});

const CLIENT_SOURCE = new URL("../src/dashboard-client.tsx", import.meta.url);
const DASHBOARD_SERVER = new URL("../src/dashboard.ts", import.meta.url);
const BUNDLE_PATH = new URL(
  "../dist/public/dashboard-client.js",
  import.meta.url,
);

test("dashboard-client imports formatRegionDisplay", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("formatRegionDisplay"),
    "dashboard-client.tsx must import formatRegionDisplay",
  );
});

test("dashboard-client imports formatDeniedUntilLabel", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("formatDeniedUntilLabel"),
    "dashboard-client.tsx must import formatDeniedUntilLabel",
  );
});

test('dashboard-client source does not contain "Antal nekanden"', () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    !source.includes("Antal nekanden"),
    'dashboard-client.tsx must not contain phrase "Antal nekanden"',
  );
});

test("dashboard-client source does not contain local deniedUntilLabel function", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    !source.includes("function deniedUntilLabel"),
    "must import, not define locally",
  );
  assert.ok(
    !source.includes("const deniedUntilLabel"),
    "must import, not define locally",
  );
  assert.ok(
    !source.includes("function formatDeniedUntilLabel"),
    "must import, not define locally",
  );
  assert.ok(
    !source.includes("const formatDeniedUntilLabel"),
    "must import, not define locally",
  );
});

test("dashboard-client imports formatRegionOptionLabel", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("formatRegionOptionLabel"),
    "must import formatRegionOptionLabel",
  );
});

test("RegionDisplay calls formatRegionDisplay helper", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("formatRegionDisplay("),
    "RegionDisplay must call formatRegionDisplay",
  );
  const regionDisplayFunc = source.match(
    /function RegionDisplay[\s\S]{0,800}return/,
  );
  if (regionDisplayFunc) {
    assert.ok(
      regionDisplayFunc[0].includes("formatRegionDisplay("),
      "RegionDisplay body must call formatRegionDisplay",
    );
  }
});

test('dashboard bundle does not contain "Antal nekanden"', () => {
  const bundle = readFileSync(BUNDLE_PATH, "utf-8");
  assert.ok(
    !bundle.includes("Antal nekanden"),
    'dashboard bundle must not contain "Antal nekanden"',
  );
});

test("dashboard-client använder publikt observer-status-API", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("/api/v1/observers/"),
    "dashboard-client.tsx must use /api/v1/observers/ endpoint",
  );
  assert.ok(
    source.includes("encodeURIComponent"),
    "dashboard-client.tsx must encode public key in URL",
  );
});

test("dashboard-client har ObserverLookup-komponent", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("function ObserverLookup("),
    "dashboard-client.tsx must define ObserverLookup component",
  );
  assert.ok(
    source.includes("function ObserverLookupResultView("),
    "dashboard-client.tsx must define ObserverLookupResultView component",
  );
});

test("API returnerar text för unknown", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("Observer har inte setts av någon broker"),
    "dashboard.ts must return unknown message text",
  );
});

test("API returnerar text för invalid", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("Ogiltig public key"),
    "dashboard.ts must return invalid message text",
  );
});

test("API returnerar text för serverfel", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("Det gick inte att kolla upp observern just nu"),
    "dashboard.ts must return error message text",
  );
});

test("dashboard-client visar 'Kolla upp' knapp", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("Kolla upp"), "must show lookup button text");
  assert.ok(
    source.includes("Klistra in din public key"),
    "must show description text",
  );
});

test("dashboard-client använder deniedUntilLabel för Nekas till", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("deniedUntilLabel("),
    "ObserverLookupResultView must call deniedUntilLabel",
  );
});

test("dashboard-client har loading-state i lookup", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("Söker..."), "must show loading text");
  assert.ok(
    source.includes("setLoading(true)"),
    "must set loading state before fetch",
  );
});

test("region-name har word-break: normal", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  const regionNameMatch = serverSource.match(/\.region-name\s*\{[^}]*\}/g);
  assert.ok(regionNameMatch, ".region-name CSS rule must exist");
  assert.ok(
    regionNameMatch.some((rule) => rule.includes("word-break")),
    ".region-name must include word-break property",
  );
});

test("region-code har white-space: nowrap", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  const regionCodeMatch = serverSource.match(/\.region-code\s*\{[^}]*\}/g);
  assert.ok(regionCodeMatch, ".region-code CSS rule must exist");
  assert.ok(
    regionCodeMatch.some(
      (rule) =>
        rule.includes("white-space: nowrap") ||
        rule.includes("white-space:nowrap"),
    ),
    ".region-code must include white-space: nowrap",
  );
});

test("publish-feed element använder publish-region klass", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    !source.includes('data-label="IATA"'),
    "data-label must not reference IATA",
  );
  assert.ok(
    source.includes("publish-region"),
    "publish feed must use publish-region class",
  );
});

test("observer-tabellens regionkolumn har region-cell klass", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("region-cell"),
    "observer table region td must have region-cell class",
  );
});

test("detail-grid-dl klass finns i lookup-komponenten", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("detail-grid-dl"),
    "observer lookup must use detail-grid-dl class",
  );
});

test("CSS mobil-breakpoint har single-column detail-grid", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(
      "detail-grid, .detail-grid.compact { grid-template-columns: 1fr; }",
    ),
    "mobile CSS must set detail-grid to single column",
  );
});

test("CSS mobil publish-row är single-column card-layout", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(".publish-row") &&
      serverSource.includes("grid-template-columns: 1fr"),
    "mobile publish-row CSS must use single column grid",
  );
  assert.ok(
    serverSource.includes(".publish-pill::before"),
    "mobile publish-pill must use ::before pseudo-elements for labels",
  );
});

test("publish-feed header använder Region istället för IATA", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("<span>Region</span>"),
    "publish feed header column must be labeled Region, not IATA",
  );
  assert.ok(
    source.includes('className="publish-region"'),
    "publish feed region cell must use publish-region class",
  );
});

test("mobile filter-bar stackas vertikalt", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(".filter-bar") &&
      serverSource.includes("flex-direction: column"),
    "CSS must have mobile filter-bar stacked vertically",
  );
});

test("mobile modal har reducerad typografi", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(".modal-header h2") &&
      serverSource.includes("font-size: 18px"),
    "mobile modal h2 must be reduced to 18px",
  );
});

test("RegionDisplay använder inte word-break: break-all", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    !serverSource.includes("region-name") ||
      !serverSource
        .match(/\.region-name\s*\{[^}]*\}/g)
        ?.some((rule) => rule.includes("word-break: break-all")),
    "region-name must not use word-break: break-all",
  );
});

test("RegionDisplay code-del har white-space: nowrap", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  const codeRules = serverSource.match(/\.region-code\s*\{[^}]*\}/g);
  assert.ok(codeRules, ".region-code CSS rule must exist");
  assert.ok(
    codeRules.some(
      (rule) =>
        rule.includes("white-space: nowrap") ||
        rule.includes("white-space:nowrap"),
    ),
    ".region-code must have white-space: nowrap",
  );
});

test("unknown lookup-resultat har neutral bakgrund (grå)", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(".lookup-result.unknown"),
    "must have .lookup-result.unknown CSS rule",
  );
});

test("unknown lookup-resultat använder gray pill", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes('pillTone = "gray"'),
    "unknown must use gray pill tone",
  );
});

test("publish-pill har ingen input-liknande styling", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  // publish-pill should NOT have border/background/padding like an input field
  const pillRules = serverSource.match(/\.publish-pill\s*\{[^}]*\}/g);
  assert.ok(pillRules, ".publish-pill CSS rule must exist");
  const mainPillRule = pillRules.find((rule) => !rule.includes("@media"));
  assert.ok(mainPillRule, "desktop .publish-pill rule must exist");
  assert.ok(
    !mainPillRule.includes("border:") && !mainPillRule.includes("background:"),
    ".publish-pill must not have border or background on desktop",
  );
});

test("mobile observer search har kort placeholder-text", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("Sök observer eller region"),
    "placeholder must be short enough for mobile",
  );
});

test("stockholmTime i dashboard-helpers konkatenerar ej timezone", () => {
  const source = readFileSync(
    new URL("../src/dashboard-helpers.ts", import.meta.url),
    "utf-8",
  );
  const stockholmTimeBody = source.match(
    /function stockholmTime\(timestamp[\s\S]*?\n\}/,
  );
  assert.ok(stockholmTimeBody, "stockholmTime function must exist");
  assert.ok(
    !stockholmTimeBody[0].includes("`") ||
      !stockholmTimeBody[0].includes(" Europe/Stockholm"),
    "stockholmTime must not concat timezone",
  );
});

test("CSS 640px breakpoint har modal h2 clamp max 20px", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("max-width: 640px"),
    "640px breakpoint must exist",
  );
  assert.ok(
    serverSource.includes("clamp(16px, 4.5vw, 20px)"),
    "modal-header h2 must use clamp(16px, 4.5vw, 20px)",
  );
});

test("CSS 640px breakpoint har panel-subtitle 10px med line-clamp", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("max-width: 640px") &&
      serverSource.includes(".modal-header .panel-subtitle") &&
      serverSource.includes("font-size: 10px"),
    "modal panel-subtitle must be 10px at 640px",
  );
  assert.ok(
    serverSource.includes("webkit-line-clamp: 2"),
    "modal panel-subtitle must use line-clamp at 640px",
  );
});

test("CSS 640px breakpoint har detail-grid padding 4px 6px", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("max-width: 640px") &&
      serverSource.includes("padding: 4px 6px"),
    "detail-grid cards must have padding 4px 6px at 640px",
  );
  assert.ok(
    serverSource.includes("gap: 4px"),
    "detail-grid gap must be 4px at 640px",
  );
});

test("CSS 640px breakpoint har icon-button ghost-stil med 18px ikon", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("max-width: 640px") &&
      serverSource.includes(".icon-button") &&
      serverSource.includes("border: none") &&
      serverSource.includes("background: transparent"),
    "icon-button must be ghost/transparent at 640px",
  );
  assert.ok(
    serverSource.includes("width: 18px"),
    "icon-button mdi must be 18px at 640px",
  );
});

test("CSS 640px breakpoint model td har padding 3px", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("max-width: 640px") &&
      serverSource.includes(".modal table td") &&
      serverSource.includes("padding: 3px 2px"),
    "modal table td must have compact 3px padding at 640px",
  );
});
