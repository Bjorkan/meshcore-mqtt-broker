import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

const APP_SOURCE = new URL("../dashboard/src/app.tsx", import.meta.url);
const DASHBOARD_SERVER = new URL("../src/dashboard.ts", import.meta.url);
const CLIENT_INDEX = new URL("../dist/public/index.html", import.meta.url);
const SCREENSHOT_HARNESS = new URL(
  "../scripts/capture-dashboard-screenshots.mjs",
  import.meta.url,
);
const DASHBOARD_SEED = new URL(
  "../scripts/seed-dashboard-demo.mjs",
  import.meta.url,
);
const SCREENSHOT_WORKFLOW = new URL(
  "../.github/workflows/dashboard-screenshots.yml",
  import.meta.url,
);
const { DASHBOARD_SCREENSHOT_COVERAGE_COUNT, prepareOutputDirectory } =
  await import(SCREENSHOT_HARNESS);
const {
  DASHBOARD_DEMO_CONFIRM_VALUE,
  assertDemoSeedConfirmed,
  buildMessages,
  buildPersistedMapAdvert,
  demoTimestamp,
} = await import(DASHBOARD_SEED);

test("dashboard screenshot harness keeps objective audit safeguards", () => {
  const source = readFileSync(SCREENSHOT_HARNESS, "utf-8");
  for (const contract of [
    'page.on("console"',
    'page.on("pageerror"',
    'page.on("requestfailed"',
    "duplicate IDs",
    "aria-sort",
    "focus-visible",
    "touch targets below 44px",
    "main content overlaps fixed app bar",
    "dialog escapes viewport",
    "computed text contrast below WCAG threshold",
    "effectiveOpaqueBackground",
    "requiredRatio = largeText ? 3 : 4.5",
    "NodeFilter.SHOW_TEXT",
    "svg, canvas, img, picture, video, audio",
    ".maplibregl-map",
    "button:disabled",
    'style.backgroundImage !== "none"',
  ]) {
    assert.ok(source.includes(contract), `missing audit contract: ${contract}`);
  }
  assert.ok(
    !source.includes("waitForTimeout("),
    "harness must wait on observable state rather than arbitrary sleeps",
  );
});

test("dashboard screenshot contrast audit resolves empty control placeholders", () => {
  const source = readFileSync(SCREENSHOT_HARNESS, "utf-8");
  for (const contract of [
    'element.matches("input, textarea")',
    "!element.value",
    'globalThis.getComputedStyle(element, "::placeholder")',
    "placeholderOpacity",
    "foreground.a * placeholderOpacity",
  ]) {
    assert.ok(
      source.includes(contract),
      `missing placeholder contrast contract: ${contract}`,
    );
  }
  assert.ok(
    source.includes("globalThis.getComputedStyle(element);"),
    "entered values must keep using the control's normal computed style",
  );
});

test("dashboard screenshot harness preserves unrelated output entries", () => {
  const source = readFileSync(SCREENSHOT_HARNESS, "utf-8");
  assert.ok(
    !source.includes("rm(outputDir, { recursive: true"),
    "the output directory itself must never be recursively deleted",
  );
  assert.ok(source.includes("readdir(directory"));
  assert.ok(source.includes("unlink(path.join(directory"));
});

test("dashboard screenshot cleanup deletes only numbered harness PNGs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "dashboard-cleanup-"));
  try {
    await Promise.all([
      writeFile(path.join(directory, "01-desktop-overview.png"), "old"),
      writeFile(path.join(directory, "999-state-mobile-loading.png"), "old"),
      writeFile(path.join(directory, "manual.png"), "keep"),
      writeFile(path.join(directory, "01-human-notes.txt"), "keep"),
      writeFile(path.join(directory, "03-desktop-personal.png"), "keep"),
      writeFile(path.join(directory, "1-too-short.png"), "keep"),
      writeFile(path.join(directory, "0000-too-long.png"), "keep"),
      writeFile(path.join(directory, "dashboard-api.json"), "keep"),
    ]);
    const nested = path.join(directory, "02-nested-artifact.png");
    await mkdir(nested);
    await writeFile(path.join(nested, "keep.txt"), "keep");

    await prepareOutputDirectory(directory);

    assert.equal(
      JSON.stringify((await readdir(directory)).sort()),
      JSON.stringify([
        "0000-too-long.png",
        "01-human-notes.txt",
        "02-nested-artifact.png",
        "03-desktop-personal.png",
        "1-too-short.png",
        "dashboard-api.json",
        "manual.png",
      ]),
    );
    assert.equal(JSON.stringify(await readdir(nested)), '["keep.txt"]');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dashboard screenshot cleanup creates a missing output directory", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "dashboard-output-"));
  const directory = path.join(parent, "new-output");
  try {
    await prepareOutputDirectory(directory);
    assert.equal(JSON.stringify(await readdir(directory)), "[]");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("dashboard screenshot harness covers the required responsive states", () => {
  const source = readFileSync(SCREENSHOT_HARNESS, "utf-8");
  assert.equal(DASHBOARD_SCREENSHOT_COVERAGE_COUNT, 61);
  assert.ok(source.includes("width: 1199"));
  assert.ok(source.includes("width: 1200"));
  assert.ok(source.includes("width: 1600"));
  assert.ok(source.includes("`mobile dark ${route}`"));
  assert.ok(source.includes("captureLongDialogsAtMobileWidths"));
  assert.ok(source.includes("{ width: 320, height: 720 }"));
  assert.ok(source.includes("{ width: 390, height: 844 }"));
  assert.ok(source.includes("exerciseAllRoutes"));
  assert.ok(source.includes('"meshcoreio",'));
  assert.ok(
    source.includes(
      "No adverts with coordinates were reported in the last 7 days.",
    ),
  );
  assert.ok(source.includes("MeshCore.io adverts with coordinates"));
  assert.ok(source.includes('getAttribute("aria-pressed")'));
  assert.ok(source.includes("captureMapSelectionRefresh"));
  assert.ok(source.includes("requestCount >= 2"));
  assert.ok(source.includes("No observers have reported yet"));
  assert.ok(source.includes("state-fatal-api-error"));
  assert.ok(source.includes("state-refresh-warning"));
  assert.ok(source.includes("captureMapResourceFailure"));
  assert.ok(source.includes("failMapStyle: true"));
  assert.ok(source.includes("state-map-resource-failure"));
  assert.ok(
    source.includes(
      "Map resource failure must retain both the visible fallback and accessible advert list",
    ),
  );
  assert.ok(source.includes("capturePostReadyMapResourceFailure"));
  assert.ok(source.includes("POST_READY_MAP_STYLE"));
  assert.ok(source.includes("synthetic-map-resource.invalid/tiles"));
  assert.ok(
    source.includes("A map resource failed after the map became ready"),
  );
  assert.ok(source.includes("state-map-post-ready-resource-failure"));
  assert.ok(
    source.includes(
      "Post-ready map resource failure changed the complete accessible advert count",
    ),
  );
  assert.ok(
    source.includes(
      "matchesAny(message.location().url, expectedFailedResponseUrls)",
    ),
  );
  assert.ok(
    source.includes("expectedFailedResponseUrls: [syntheticMapTilePattern]"),
  );

  const postReadyStart = source.indexOf(
    "async function capturePostReadyMapResourceFailure",
  );
  const postReadyEnd = source.indexOf(
    "async function captureDesktop",
    postReadyStart,
  );
  const postReadySource = source.slice(postReadyStart, postReadyEnd);
  assert.ok(postReadyStart >= 0 && postReadyEnd > postReadyStart);
  assert.ok(
    postReadySource.indexOf("await waitForMapReady(page)") <
      postReadySource.indexOf("auditPage.enablePostReadyMapResourceFailure()"),
    "the synthetic tile may fail only after observable map readiness",
  );
  assert.ok(
    !postReadySource.includes("extraConsoleAllowlist"),
    "post-ready coverage must allowlist only its URL-scoped synthetic response failure",
  );
});

test("dashboard demo seed requires explicit review-database confirmation before data access", () => {
  assert.equal(DASHBOARD_DEMO_CONFIRM_VALUE, "replace-review-database");
  const previous = process.env.DASHBOARD_DEMO_CONFIRM;
  try {
    delete process.env.DASHBOARD_DEMO_CONFIRM;
    assert.throws(
      () => assertDemoSeedConfirmed(),
      /Refusing to open or seed \/data\/meshcore-mqtt-broker/,
    );
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_DEMO_CONFIRM;
    else process.env.DASHBOARD_DEMO_CONFIRM = previous;
  }
  assert.throws(
    () => assertDemoSeedConfirmed("yes"),
    /DASHBOARD_DEMO_CONFIRM=replace-review-database/,
  );
  assert.doesNotThrow(() => assertDemoSeedConfirmed("replace-review-database"));

  const source = readFileSync(DASHBOARD_SEED, "utf-8");
  const mainIndex = source.indexOf("async function main()");
  const confirmationIndex = source.indexOf(
    "assertDemoSeedConfirmed();",
    mainIndex,
  );
  const databaseImportIndex = source.indexOf(
    "await import(distDatabase)",
    mainIndex,
  );
  const dataMkdirIndex = source.indexOf(
    "await mkdir(DATABASE_DIRECTORY",
    mainIndex,
  );
  assert.ok(mainIndex >= 0);
  assert.ok(confirmationIndex > mainIndex);
  assert.ok(databaseImportIndex > confirmationIndex);
  assert.ok(dataMkdirIndex > confirmationIndex);
});

test("dashboard screenshot workflow is the explicit demo-seed confirmation owner", () => {
  const workflow = readFileSync(SCREENSHOT_WORKFLOW, "utf-8");
  assert.equal(
    workflow.match(/DASHBOARD_DEMO_CONFIRM/g)?.length,
    1,
    "confirmation must be scoped to only the seed step",
  );
  assert.match(
    workflow,
    /- name: Seed demo data[\s\S]*?env:\n\s+BROKER_RUNTIME_ID_FILE: [^\n]+\n\s+DASHBOARD_DEMO_CONFIRM: replace-review-database/,
  );
  assert.ok(workflow.includes("Viewport coverage: 320–1600 px"));
  assert.ok(workflow.includes("computed text contrast"));
  assert.ok(workflow.includes("synthetic map-resource failure fallback"));
});

test("dashboard demo seed includes validator-required message and map fields", () => {
  const source = readFileSync(DASHBOARD_SEED, "utf-8");
  assert.ok(source.includes("DASHBOARD_DEMO_NOW_MS"));
  assert.ok(source.includes("return Date.now()"));
  assert.ok(!source.includes("Math.floor(Date.now() / day) * day"));
  assert.ok(source.includes("deterministicUuid"));
  assert.ok(source.includes("fixturePublicKey(1000 + i)"));
  assert.ok(source.includes("buildPersistedMapAdvert"));
  assert.ok(!source.includes("randomUUID"));
  assert.ok(!source.includes("Math.random"));
});

test("dashboard demo message fixtures satisfy the current required shape", () => {
  const [message] = buildMessages(2_000_000, 1, {
    broker: "ReviewBroker",
    region: "STO",
    observer: "Stockholm Rooftop",
    publicKey: "A".repeat(64),
  });
  assert.deepEqual(message, {
    topic: `meshcore/STO/${"A".repeat(64)}/packets/a0`,
    broker: "ReviewBroker",
    region: "STO",
    observer: "Stockholm Rooftop",
    publicKey: "A".repeat(64),
    subtopic: "packets/a0",
    bytes: 30,
    receivedAt: 2_000_000,
  });
});

test("dashboard demo map fixtures persist request and worker identity", () => {
  const advert = {
    at: 1_000,
    nodeName: "Named advert",
    nodePublicKey: "B".repeat(64),
    advertType: "sensor",
    observerName: "Observer",
    latitude: 59.3,
    longitude: 18.1,
  };
  assert.deepEqual(
    buildPersistedMapAdvert(advert, "request-1", "ReviewBroker"),
    {
      ...advert,
      requestId: "request-1",
      workerInstanceId: "ReviewBroker",
    },
  );
});

test("dashboard demo timestamp is current by default and honors its override", () => {
  const previous = process.env.DASHBOARD_DEMO_NOW_MS;
  try {
    delete process.env.DASHBOARD_DEMO_NOW_MS;
    const before = Date.now();
    const actual = demoTimestamp();
    const after = Date.now();
    assert.ok(actual >= before && actual <= after);

    process.env.DASHBOARD_DEMO_NOW_MS = "2000000000000";
    assert.equal(demoTimestamp(), 2_000_000_000_000);

    process.env.DASHBOARD_DEMO_NOW_MS = "not-a-timestamp";
    assert.throws(demoTimestamp, /positive integer timestamp/);
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_DEMO_NOW_MS;
    else process.env.DASHBOARD_DEMO_NOW_MS = previous;
  }
});

test("dashboard-client app includes loading state", () => {
  const source = readFileSync(APP_SOURCE, "utf-8");
  assert.ok(source.includes("Loading dashboard data"));
  assert.ok(source.includes("Dashboard data could not be loaded"));
  assert.ok(source.includes("new AbortController()"));
  assert.ok(source.includes("window.setTimeout"));
  assert.ok(!source.includes("window.setInterval"));
});

test("dashboard-client app imports required views", () => {
  const source = readFileSync(APP_SOURCE, "utf-8");
  assert.ok(source.includes("OverviewView"));
  assert.ok(source.includes("ObserversView"));
  assert.ok(source.includes("MeshcoreIoView"));
  assert.ok(source.includes("BansView"));
  assert.ok(source.includes("SubscribersView"));
});

test("dashboard-client app uses dark mode localStorage toggle", () => {
  const source = readFileSync(APP_SOURCE, "utf-8");
  assert.ok(source.includes("dashboard-dark-mode"));
  assert.ok(source.includes("prefers-color-scheme"));
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

test("dashboard-server reads Vite-built index.html", () => {
  const serverSource = readFileSync(DASHBOARD_SERVER, "utf-8");
  assert.ok(
    serverSource.includes("dist/public/index.html"),
    "dashboard.ts must read Vite-built index.html",
  );
  assert.ok(
    !serverSource.includes("DASHBOARD_STYLES"),
    "dashboard.ts must not import dashboard-styles",
  );
});

test("Vite-built index.html exists and references assets", () => {
  let html;
  try {
    html = readFileSync(CLIENT_INDEX, "utf-8");
  } catch {
    assert.fail("dist/public/index.html not found. Run npm run build.");
  }
  assert.ok(
    html.includes("favicon.svg") || html.includes("/assets/"),
    "index.html must reference favicon or hashed assets",
  );
});

test("stockholmTime i dashboard-helpers konkatenerar ej timezone", () => {
  const source = readFileSync(
    new URL("../dashboard/src/helpers/format.ts", import.meta.url),
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
