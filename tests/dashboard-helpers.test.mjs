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
const DASHBOARD_STYLES = new URL("../src/dashboard-styles.ts", import.meta.url);
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
    serverSource.includes(
      "This observer has not been seen by any broker instance.",
    ),
    "dashboard.ts must return unknown message text",
  );
});

test("API returnerar text för invalid", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("Invalid public key"),
    "dashboard.ts must return invalid message text",
  );
});

test("API returnerar text för serverfel", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(
      "Observer status could not be checked. Try again later.",
    ),
    "dashboard.ts must return error message text",
  );
});

test("dashboard-client visar knapp för observatörskontroll", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("Check status"), "must show lookup button text");
  assert.ok(
    source.includes("Enter an observer public key"),
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
  assert.ok(source.includes("Checking…"), "must show loading text");
  assert.ok(
    source.includes("setLoading(true)"),
    "must set loading state before fetch",
  );
});

test("dashboard-client visar verkligt tomläge utan inbyggd demodata", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(!source.includes("function demoObserver("));
  assert.ok(!source.includes("function demoBan("));
  assert.ok(!source.includes("Demo observer"));
});

test("dashboard-client visar laddnings- och uppdateringsfel", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("Loading dashboard data"));
  assert.ok(source.includes("Data could not be refreshed"));
  assert.ok(source.includes("new AbortController()"));
  assert.ok(source.includes("window.setTimeout"));
  assert.ok(!source.includes("window.setInterval"));
});

test("dashboard-modal låser fokus och återställer sidans scroll", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes('event.key !== "Tab"'));
  assert.ok(source.includes('document.body.style.overflow = "hidden"'));
  assert.ok(source.includes("previouslyFocused?.focus()"));
});

test("dashboard-client visar bara 10 senaste nekade på översikten", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("const overviewBans = useMemo("),
    "dashboard-client.tsx must derive overview-specific bans",
  );
  assert.ok(
    source.includes(".slice(0, 10)"),
    "overview bans must be capped at 10 entries",
  );
});

test("dashboard-client länkar från översiktens nekade till Nekade-vyn", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("View all protection events"),
    "overview bans panel must include a show-more button",
  );
  assert.ok(
    source.includes('onClick={() => setView("bans")}'),
    "show-more button must navigate to the bans view",
  );
});

test("dashboard-server använder separat Material 3-stilmall", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(
      'import { DASHBOARD_STYLES } from "./dashboard-styles.js"',
    ),
  );
  assert.ok(serverSource.includes("<style>${DASHBOARD_STYLES}</style>"));
});

test("Material 3-stilmallen definierar centrala färg-, form- och elevationsroller", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  for (const token of [
    "--md-sys-color-primary",
    "--md-sys-color-surface-container-lowest",
    "--md-sys-color-outline-variant",
    "--shape-xl",
    "--shadow-dialog",
  ]) {
    assert.ok(styles.includes(token), `missing Material 3 token ${token}`);
  }
});

test("dashboarden använder Material 3-appskal med drawer och top app bar", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(styles.includes(".navigation-drawer"));
  assert.ok(styles.includes(".top-app-bar"));
  assert.ok(styles.includes(".page-heading"));
  assert.ok(
    source.includes('className={`navigation-drawer ${navOpen ? "open" : ""}`}'),
  );
  assert.ok(source.includes('className="top-app-bar"'));
});

test("vald navigation använder secondary container enligt Material 3", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes('.nav-item[aria-current="page"]'));
  assert.ok(
    styles.includes("background: var(--md-sys-color-secondary-container)"),
  );
});

test("regiontext bryts inte sönder och regionkod hålls samman", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  const regionName = styles.match(/\.region-name\s*\{[^}]*\}/)?.[0];
  const regionCode = styles.match(/\.region-code\s*\{[^}]*\}/)?.[0];
  assert.ok(regionName?.includes("word-break: normal"));
  assert.ok(regionName?.includes("overflow-wrap: normal"));
  assert.ok(regionCode?.includes("white-space: nowrap"));
  assert.ok(!regionName?.includes("break-all"));
});

test("publish-feed använder Region och semantiska metadatafält", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(!source.includes('data-label="IATA"'));
  assert.ok(source.includes("<span>Region</span>"));
  assert.ok(source.includes('className="publish-region"'));
  assert.ok(source.includes('className="publish-meta"'));
});

test("observer-tabellens regionkolumn har region-cell klass", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("region-cell"));
});

test("observeruppslagningen använder semantisk detaljlista", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("detail-grid-dl"));
});

test("mobil layout använder kontinuerliga listor i stället för kort per tabellrad", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes("@media (max-width: 800px)"));
  assert.ok(styles.includes("tbody tr {"));
  assert.ok(styles.includes("border: 1px solid var(--surface-border)"));
  assert.ok(
    styles.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"),
  );
  assert.ok(!styles.includes(".mobile-card"));
});

test("mobil filterrad och detaljgrid blir enkolumn", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.match(
    styles,
    /@media \(max-width: 800px\)[\s\S]*?\.filter-bar\s*\{[\s\S]*?grid-template-columns: 1fr/,
  );
  assert.match(
    styles,
    /@media \(max-width: 460px\)[\s\S]*?\.detail-grid,[\s\S]*?grid-template-columns: 1fr/,
  );
});

test("dialoger följer responsiva Material 3-mönster", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes(".modal.sm {"), "small dialog rule missing");
  assert.ok(styles.includes("max-height: min(88dvh, 900px)"));
  assert.match(
    styles,
    /@media \(max-width: 800px\)[\s\S]*?place-items: end center/,
  );
  assert.ok(styles.includes("border-radius: var(--shape-xl)"));
});

test("unknown lookup-resultat använder neutral surface container", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes(".lookup-result {"));
  assert.ok(
    styles.includes("background: var(--md-sys-color-surface-container-low)"),
  );
});

test("dekorativa pill- och chipklasser har tagits bort", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  for (const obsolete of ["publish-pill", "broker-chip", 'className="pill"']) {
    assert.ok(
      !source.includes(obsolete),
      `obsolete decorative class remains: ${obsolete}`,
    );
  }
});

test("status visas med text och diskret punkt i stället för pill", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes("function StatusLabel("));
  assert.ok(styles.includes(".status-label::before"));
  const rule = styles.match(/\.status-label\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(!rule.includes("background:"));
  assert.ok(!rule.includes("border-radius:"));
});

test("interaktiva kontroller har tillräckliga pekmål", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  const iconButton = styles.match(/\.icon-button\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(iconButton.includes("width: 46px"));
  assert.ok(iconButton.includes("height: 46px"));
  assert.ok(styles.includes("min-height: 44px"));
});

test("stilmallen innehåller synligt fokus och reduced-motion-stöd", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes(":focus-visible"));
  assert.ok(styles.includes("@media (prefers-reduced-motion: reduce)"));
});

test("mobilskalet tar hänsyn till enhetens safe areas", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  for (const inset of [
    "env(safe-area-inset-top)",
    "env(safe-area-inset-right)",
    "env(safe-area-inset-bottom)",
    "env(safe-area-inset-left)",
  ]) {
    assert.ok(styles.includes(inset), `missing ${inset}`);
  }
});

test("mobilens top app bar förblir synlig och separerad vid scroll", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.match(styles, /\.top-app-bar\s*\{[\s\S]*?position: sticky/);
  assert.match(
    styles,
    /\.top-app-bar\s*\{[\s\S]*?border-bottom: 1px solid var\(--surface-border\)/,
  );
});

test("Material 3-fält har beständiga etiketter och egen select-indikator", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  for (const label of ["Public key", "Search", "Region"]) {
    assert.ok(source.includes(`className="field-label">${label}`));
  }
  assert.match(styles, /select\s*\{[\s\S]*?appearance: none/);
  assert.ok(styles.includes("background-image:"));
});

test("hover använder pekdonsskyddade M3-state layers", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(styles.includes("@media (hover: hover) and (pointer: fine)"));
  assert.ok(styles.includes(".lookup-button:not(:disabled):hover"));
  assert.ok(!styles.includes("filter: brightness"));
  assert.ok(styles.includes(".lookup-button:not(:disabled):active"));
});

test("primära tabellceller visar status med text, inte bara färg", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes('className="primary-stack"'));
  assert.ok(source.includes("brokerStatusLabelTone(broker)"));
  assert.ok(source.includes("observerStatusText(statusTone)"));
});

test("varje vy visar en relevant kontextetikett", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  for (const eyebrow of [
    'eyebrow: "Cluster overview"',
    'eyebrow: "Operations"',
    'eyebrow: "Network"',
    'eyebrow: "Security"',
    'eyebrow: "Access"',
  ]) {
    assert.ok(source.includes(eyebrow), `missing ${eyebrow}`);
  }
  assert.ok(source.includes("{currentPage.eyebrow}"));
});

test("tabeller behåller radhöjd utan onödig tablet-scroll", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.match(styles, /table\s*\{[^}]*min-width: 680px/);
  assert.match(styles, /td\s*\{[^}]*height: 56px/);
  assert.match(
    styles,
    /@media \(max-width: 800px\)[\s\S]*?tbody td\s*\{[\s\S]*?height: auto/,
  );
});

test("varumärkesikonen använder dashboardens primärfärg", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(source.includes("var(--md-sys-color-primary, #0b6b50)"));
  assert.ok(serverSource.includes('fill="#0b6b50"'));
  assert.ok(!source.includes('fill="#1f7a3d"'));
  assert.ok(!serverSource.includes('fill="#1f7a3d"'));
});

test("layouten tvingar inte horisontell overflow under 320 px", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  const htmlRule = styles.match(/html\s*\{[^}]*\}/)?.[0] ?? "";
  const bodyRule = styles.match(/body\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(htmlRule.includes("min-width: 320px"));
  assert.ok(bodyRule.includes("min-width: 320px"));
});

test("brokerfördelningen använder en konsekvent M3-färg och synlig status", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes('className="distribution-copy"'));
  assert.ok(source.includes("brokerStatusText(broker)"));
  assert.ok(!styles.includes(".distribution-item:nth-child"));
});

test("mobile observer search har kort placeholder-text", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("Search by observer, key, or region"),
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
