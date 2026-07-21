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

test("dashboard-client använder Astryx loading-state i lookup", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("isLoading={loading}"),
    "Astryx Button must expose loading state",
  );
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

test("dashboard-modal använder Astryx Dialog för fokus och scrollås", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes(
      'import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog"',
    ),
  );
  assert.ok(source.includes("<Dialog"));
  assert.ok(source.includes("<DialogHeader"));
  assert.ok(source.includes("onOpenChange="));
  assert.ok(!source.includes('document.body.style.overflow = "hidden"'));
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
    source.includes("View protection events"),
    "overview bans panel must include a show-more button",
  );
  assert.ok(
    source.includes('onClick={() => setView("bans")}'),
    "show-more button must navigate to the bans view",
  );
});

test("dashboard-server använder separat Astryx-anpassad stilmall", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes(
      'import { DASHBOARD_STYLES } from "./dashboard-styles.js"',
    ),
  );
  assert.ok(serverSource.includes("<style>${DASHBOARD_STYLES}</style>"));
});

test("Astryx-stilmallen använder design tokens för färg, form och elevation", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  for (const token of [
    "--color-accent",
    "--color-background-surface",
    "--color-border",
    "--radius-element",
    "--shadow-low",
  ]) {
    assert.ok(styles.includes(token), `missing Astryx token ${token}`);
  }
  assert.ok(!styles.includes("--md-sys-color"));
});

test("dashboarden använder Astryx AppShell, SideNav och TopNav", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes('import { AppShell } from "@astryxdesign/core/AppShell"'),
  );
  assert.ok(source.includes("<AppShell"));
  assert.ok(source.includes("<SideNav"));
  assert.ok(source.includes("<TopNav"));
  assert.ok(source.includes("<Section"));
  assert.ok(!source.includes("navigation-drawer"));
});

test("interaktiva tabeller behåller radsemantik och använder riktiga knappar", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes('className="row-action'));
  assert.ok(!source.includes('role="button"'));
  assert.ok(!source.includes("React.KeyboardEvent<HTMLTableRowElement>"));
});

test("deep links behålls i state tills första snapshoten kan lösas", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes("const [selectedObserverKey, setSelectedObserverKey]"),
  );
  assert.ok(
    source.includes("selectedObserver || !selectedObserverKey || !snapshot"),
  );
  assert.ok(source.includes("selectedBan || !selectedBanKey || !snapshot"));
});

test("vald navigation styrs av Astryx SideNavItem", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<SideNavItem"));
  assert.ok(source.includes("isSelected={view === item.view}"));
  assert.ok(source.includes("href={`#${item.view}`}"));
});

test("regiontext använder Astryx text- och stackkomponenter", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes('<Stack as="span" gap={0}>'));
  assert.ok(source.includes('<Text as="span" weight="medium">'));
  assert.ok(source.includes('color="secondary" type="supporting"'));
});

test("publish-feed använder Astryx Table och behåller alla metadatafält", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(!source.includes('data-label="IATA"'));
  assert.ok(source.includes("<TableHeaderCell>Region</TableHeaderCell>"));
  assert.ok(source.includes("<TableHeaderCell>Subtopic</TableHeaderCell>"));
  assert.ok(
    source.includes("<TableHeaderCell>Broker instance</TableHeaderCell>"),
  );
});

test("observer-tabellens regionkolumn har region-cell klass", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("region-cell"));
});

test("observeruppslagningen använder semantisk detaljlista", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<MetadataList>"));
  assert.ok(source.includes('<MetadataListItem label="Observer">'));
});

test("mobil layout lämnar tabellresponsivitet till Astryx", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(!styles.includes("tbody tr"));
  assert.ok(!styles.includes("thead"));
  assert.ok(!styles.includes(".mobile-card"));
});

test("filter och detaljvyer använder Astryx responsiva komponenter", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("columns={{ minWidth: 280, max: 2"));
  assert.ok(source.includes('<MetadataList columns="multi">'));
  assert.ok(!source.includes('className="detail-grid'));
});

test("dialoger använder Astryx Dialog och responsiv storleksgräns", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<Dialog"));
  assert.ok(source.includes("<DialogHeader"));
  assert.ok(source.includes('maxHeight="88dvh"'));
  assert.ok(source.includes("width={width}"));
  assert.ok(source.includes("<Layout"));
});

test("lookup-resultat använder Astryx Banner och Section", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<Banner"));
  assert.ok(source.includes('<Section padding={4} variant="muted">'));
  assert.ok(!source.includes('className="lookup-result'));
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

test("status visas med Astryx StatusDot och text", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes('import { StatusDot } from "@astryxdesign/core/StatusDot"'),
  );
  assert.ok(source.includes("<StatusDot"));
  assert.ok(source.includes("{children}"));
});

test("interaktiva kontroller använder Astryx Button och navigation", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(
    source.includes('import { Button } from "@astryxdesign/core/Button"'),
  );
  assert.ok(source.includes("<Button"));
  assert.ok(source.includes("<SideNavItem"));
});

test("Astryx reset äger fokus och specialstilen respekterar reduced motion", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes('import "@astryxdesign/core/reset.css"'));
  assert.ok(styles.includes("@media (prefers-reduced-motion: reduce)"));
});

test("mobilskalet hanteras av Astryx utan egen drawer-CSS", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes("<AppShell"));
  assert.ok(!styles.includes("safe-area-inset"));
  assert.ok(!styles.includes("navigation-drawer"));
});

test("mobilnavigation hanteras av Astryx AppShell", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<AppShell"));
  assert.ok(source.includes('height="auto"'));
  assert.ok(source.includes("window.scrollTo(0, 0)"));
  assert.ok(source.includes('variant="elevated"'));
  assert.ok(!source.includes("navOpen"));
});

test("Astryx-fält har beständiga etiketter och Selector", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes('label="Public key"'));
  assert.ok(source.includes('label="Search"'));
  assert.ok(source.includes("<Selector"));
  assert.ok(source.includes('label="Region"'));
  assert.ok(!source.includes("<select"));
});

test("specialstilen skriver inte över Astryx interaktionslägen", () => {
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(!styles.includes(":hover"));
  assert.ok(!styles.includes(":active"));
  assert.ok(!styles.includes("!important"));
});

test("primära tabellceller visar status med text, inte bara färg", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  assert.ok(source.includes("<StatusLabel"));
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

test("tabeller använder Astryx densitet utan globala elementöverskrivningar", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes('density="compact"'));
  assert.ok(!styles.match(/(^|\n)\s*table\s*\{/));
  assert.ok(!styles.match(/(^|\n)\s*(th|td)\s*[,{]/));
});

test("varumärkesikonen använder Astryx accentfärg", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(source.includes("<NavIcon"));
  assert.ok(source.includes("<AstryxIcon"));
  assert.ok(serverSource.includes('fill="#087a55"'));
});

test("layoutens minbredd lämnas till Astryx reset", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes('import "@astryxdesign/core/reset.css"'));
  assert.ok(!styles.match(/(^|\n)\s*(html|body)\s*\{/));
});

test("brokerfördelningen använder Astryx ProgressBar och synlig status", () => {
  const source = readFileSync(CLIENT_SOURCE, "utf-8");
  const styles = readFileSync(DASHBOARD_STYLES, "utf-8");
  assert.ok(source.includes("<ProgressBar"));
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
