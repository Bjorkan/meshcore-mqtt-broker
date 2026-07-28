import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const dashboardUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8080";
const outputDir = path.resolve(
  process.env.DASHBOARD_SCREENSHOT_DIR || "dashboard-screenshots",
);
const dashboardApiPattern = "**/api/dashboard";
const MAP_STYLE = JSON.stringify({ version: 8, sources: {}, layers: [] });
const mapStylePattern =
  /^https:\/\/basemaps\.cartocdn\.com\/gl\/.*\/style\.json(?:\?.*)?$/;
const SYNTHETIC_MAP_TILE_TEMPLATE =
  "https://synthetic-map-resource.invalid/tiles/{z}/{x}/{y}.png";
const syntheticMapTilePattern =
  /^https:\/\/synthetic-map-resource\.invalid\/tiles\/\d+\/\d+\/\d+\.png(?:\?.*)?$/;
const POST_READY_MAP_STYLE = JSON.stringify({
  version: 8,
  sources: {
    "synthetic-post-ready-tiles": {
      type: "raster",
      tiles: [SYNTHETIC_MAP_TILE_TEMPLATE],
      tileSize: 256,
    },
  },
  layers: [
    {
      id: "synthetic-post-ready-tiles",
      type: "raster",
      source: "synthetic-post-ready-tiles",
    },
  ],
});
const TRANSPARENT_MAP_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const REQUIRED_FIXTURES = {
  observer: "Stockholm Rooftop",
  longObserver:
    "Very Long Observer Name That Might Overflow Table Cells In Some Viewports",
  ban: "Drifting Node",
  subscriber: "visual-review",
  mapAdvert: "Uppsala Field Sensor",
};
const VIEW_TITLES = {
  overview: "Overview",
  observers: "Observers",
  bans: /^(?:Bans|Protection events)$/,
  subscribers: "Subscribers",
  meshcoreio: "MeshCore.io",
};
const DARK_ROUTES = Object.keys(VIEW_TITLES);
const KNOWN_SCREENSHOT_NAMES = new Set([
  "desktop-overview",
  "desktop-observers",
  "desktop-observers-sort-descending",
  "desktop-observers-sort-ascending",
  "desktop-observer-dialog",
  "desktop-observer-dialog-scrolled",
  "desktop-observer-dialog-long-content",
  "desktop-bans",
  "desktop-bans-sort-descending",
  "desktop-bans-sort-ascending",
  "desktop-ban-dialog-iata",
  "desktop-subscribers",
  "desktop-subscribers-sort-descending",
  "desktop-subscriber-dialog",
  "desktop-meshcoreio",
  "desktop-meshcoreio-map-fit",
  "desktop-meshcoreio-named-advert-selected",
  "desktop-meshcoreio-named-advert-refreshed",
  "mobile-overview",
  "mobile-navigation-drawer",
  "mobile-observers",
  "mobile-observers-sort-ascending",
  "mobile-observer-dialog",
  "mobile-bans",
  "mobile-ban-dialog",
  "mobile-subscribers",
  "mobile-subscriber-dialog",
  "mobile-meshcoreio",
  "responsive-320-minimum-overview",
  "responsive-600-small-tablet-overview",
  "responsive-900-narrow-overview",
  "responsive-1024-tablet-overview",
  "responsive-1199-below-lg-observers",
  "responsive-1200-lg-observers",
  "responsive-1600-wide-overview",
  "state-mobile-loading",
  "state-empty-overview",
  "state-empty-observers",
  "state-empty-bans",
  "state-empty-subscribers",
  "state-empty-meshcoreio",
  "state-map-resource-failure",
  "state-map-post-ready-resource-failure",
  "state-fatal-api-error",
  "state-refresh-warning",
  ...DARK_ROUTES.flatMap((route) => [
    `desktop-${route}-dark`,
    `mobile-${route}-dark`,
  ]),
  ...[320, 390].flatMap((width) =>
    ["observer", "ban", "subscriber"].map(
      (kind) => `mobile-${width}-long-${kind}-dialog`,
    ),
  ),
]);
export const DASHBOARD_SCREENSHOT_COVERAGE_COUNT = KNOWN_SCREENSHOT_NAMES.size;
const auditFailures = [];
const screenshotPaths = [];
let sequence = 0;

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function recordCheck(label, check) {
  try {
    await check();
  } catch (error) {
    auditFailures.push(`${label}: ${describeError(error)}`);
  }
}

function screenshot(page, name, options = {}) {
  if (!KNOWN_SCREENSHOT_NAMES.has(name)) {
    throw new Error(`Unknown dashboard screenshot artifact name: ${name}`);
  }
  sequence += 1;
  const filename = `${String(sequence).padStart(2, "0")}-${name}.png`;
  const screenshotPath = path.join(outputDir, filename);
  screenshotPaths.push(screenshotPath);
  return page.screenshot({ path: screenshotPath, fullPage: true, ...options });
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function installBrowserDiagnostics(
  page,
  label,
  extraConsoleAllowlist = [],
  expectedFailedResponseUrls = [],
) {
  const failures = [];
  const mapConsoleAllowlist = [
    /WebGL.*(?:not supported|context lost|software fallback)/i,
    /Failed to create WebGL context/i,
    /GL Driver Message/i,
  ];
  const externalMapRequest =
    /^https:\/\/(?:[^/]+\.)?(?:cartocdn\.com|basemaps\.cartocdn\.com)\//i;

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const expectedFailedResponse =
      text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)" &&
      matchesAny(message.location().url, expectedFailedResponseUrls);
    if (
      expectedFailedResponse ||
      matchesAny(text, [...mapConsoleAllowlist, ...extraConsoleAllowlist])
    ) {
      return;
    }
    failures.push(`console error: ${text}`);
  });
  page.on("pageerror", (error) => {
    failures.push(`page error: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    if (externalMapRequest.test(request.url())) return;
    const reason = request.failure()?.errorText || "unknown failure";
    failures.push(
      `request failed: ${request.method()} ${request.url()} (${reason})`,
    );
  });

  return {
    flush() {
      for (const failure of failures)
        auditFailures.push(`${label}: ${failure}`);
    },
  };
}

async function newAuditPage(
  browser,
  {
    label,
    width,
    height,
    isMobile = false,
    extraConsoleAllowlist = [],
    expectedFailedResponseUrls = [],
    interceptApi,
    failMapStyle = false,
    postReadyMapResourceFailure = false,
  },
) {
  let mapBecameReady = false;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: isMobile ? 2 : 1,
    hasTouch: isMobile,
    isMobile,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await context.route(mapStylePattern, (route) =>
    failMapStyle
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "intentional dashboard screenshot map-style failure",
          }),
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: postReadyMapResourceFailure ? POST_READY_MAP_STYLE : MAP_STYLE,
        }),
  );
  if (postReadyMapResourceFailure) {
    await context.route(syntheticMapTilePattern, (route) =>
      mapBecameReady
        ? route.fulfill({
            status: 503,
            contentType: "text/plain",
            body: "intentional post-ready map tile failure",
          })
        : route.fulfill({
            status: 200,
            contentType: "image/png",
            body: TRANSPARENT_MAP_TILE,
          }),
    );
  }
  if (interceptApi) await context.route(dashboardApiPattern, interceptApi);
  const page = await context.newPage();
  const diagnostics = installBrowserDiagnostics(
    page,
    label,
    extraConsoleAllowlist,
    expectedFailedResponseUrls,
  );
  return {
    context,
    page,
    diagnostics,
    enablePostReadyMapResourceFailure() {
      mapBecameReady = true;
    },
  };
}

async function closeAuditPage(auditPage) {
  auditPage.diagnostics.flush();
  await auditPage.context.close();
}

async function nextPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        );
      }),
  );
}

async function waitForUiSettled(page) {
  await page.waitForFunction(
    () => {
      const transitionRoot =
        ".MuiDrawer-paper, .MuiDialog-paper, .MuiBackdrop-root, .MuiAppBar-root";
      return globalThis.document.getAnimations().every((animation) => {
        const target = animation.effect?.target;
        return (
          animation.playState !== "running" ||
          !(target instanceof globalThis.Element) ||
          target.closest(transitionRoot) === null
        );
      });
    },
    undefined,
    { timeout: 5000 },
  );
  await nextPaint(page);
}

async function waitForDashboard(page, expectedHeading = "Overview") {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/dashboard" &&
      response.request().method() === "GET",
    { timeout: 15000 },
  );
  await page.goto(dashboardUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`Dashboard API returned HTTP ${response.status()}`);
  }
  await page.locator("#root").waitFor({ state: "visible", timeout: 10000 });
  await page
    .getByRole("heading", { name: expectedHeading, exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByText("Loading dashboard data…", { exact: true })
    .waitFor({ state: "hidden", timeout: 15000 });
  await waitForUiSettled(page);
}

async function readAndValidateSeedData(page) {
  const response = await page.request.get(`${dashboardUrl}/api/dashboard`);
  if (!response.ok()) {
    throw new Error(`Dashboard API returned HTTP ${response.status()}`);
  }
  const snapshot = await response.json();
  const missing = [];
  if (
    !snapshot.observers?.some(
      (item) => item.label === REQUIRED_FIXTURES.observer,
    )
  ) {
    missing.push(`observer ${JSON.stringify(REQUIRED_FIXTURES.observer)}`);
  }
  if (
    !snapshot.observers?.some(
      (item) => item.label === REQUIRED_FIXTURES.longObserver,
    )
  ) {
    missing.push(`observer ${JSON.stringify(REQUIRED_FIXTURES.longObserver)}`);
  }
  if (!snapshot.bans?.some((item) => item.label === REQUIRED_FIXTURES.ban)) {
    missing.push(`ban ${JSON.stringify(REQUIRED_FIXTURES.ban)}`);
  }
  if (
    !snapshot.subscribers?.some(
      (item) => item.username === REQUIRED_FIXTURES.subscriber,
    )
  ) {
    missing.push(`subscriber ${JSON.stringify(REQUIRED_FIXTURES.subscriber)}`);
  }
  if ((snapshot.meshcoreIo?.map?.advertsLast7Days?.length ?? 0) < 6) {
    missing.push("at least 6 MeshCore.io map adverts");
  }
  if (missing.length > 0) {
    throw new Error(`Dashboard demo fixtures missing: ${missing.join(", ")}`);
  }
  return snapshot;
}

async function openMobileNav(page) {
  const button = page.getByRole("button", {
    name: /^(?:Open menu|Open navigation menu)$/,
  });
  await button.waitFor({ state: "visible", timeout: 5000 });
  await button.click();
  await page
    .locator('[data-nav="overview"]:visible')
    .waitFor({ state: "visible", timeout: 5000 });
  await waitForUiSettled(page);
}

async function openView(page, view) {
  let target = page.locator(`[data-nav="${view}"]:visible`).first();
  if ((await target.count()) === 0) {
    await openMobileNav(page);
    target = page.locator(`[data-nav="${view}"]:visible`).first();
  }
  await target.click();
  await page.waitForURL(new RegExp(`#${view}(?:[?&]|$)`), { timeout: 5000 });
  await page
    .getByRole("heading", {
      name: VIEW_TITLES[view],
      exact: typeof VIEW_TITLES[view] === "string",
    })
    .waitFor({ state: "visible", timeout: 5000 });
  await waitForUiSettled(page);
}

function recordLocator(page, testId, text) {
  return page
    .getByTestId(testId)
    .filter({ hasText: text })
    .filter({ visible: true });
}

async function stableRecord(page, testId, text) {
  const records = recordLocator(page, testId, text);
  await records.first().waitFor({ state: "visible", timeout: 5000 });
  const count = await records.count();
  if (count !== 1) {
    throw new Error(
      `Expected one visible ${testId} containing ${JSON.stringify(text)}, found ${count}`,
    );
  }
  return records.first();
}

async function openRecord(page, testId, text) {
  const record = await stableRecord(page, testId, text);
  await record.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  await waitForUiSettled(page);
  return { record, dialog };
}

async function closeDialog(page) {
  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count();
  if (count !== 1 || !(await dialogs.first().isVisible())) {
    throw new Error(`closeDialog expected one visible dialog, found ${count}`);
  }
  const closeButton = dialogs.first().getByRole("button", {
    name: "Close",
    exact: true,
  });
  if ((await closeButton.count()) !== 1) {
    throw new Error('closeDialog could not find exactly one "Close" button');
  }
  await closeButton.click();
  await dialogs.first().waitFor({ state: "hidden", timeout: 5000 });
  await waitForUiSettled(page);
  if ((await page.getByRole("dialog").count()) > 0) {
    throw new Error("closeDialog left a dialog mounted");
  }
}

async function clickSortLabel(page, fieldName, expectedDirection) {
  const label = page
    .locator(".MuiTableSortLabel-root:visible")
    .filter({ hasText: fieldName })
    .first();
  await label.waitFor({ state: "visible", timeout: 5000 });
  await label.click();
  await nextPaint(page);
  const header = label.locator("xpath=ancestor::th[1]");
  const actual = await header.getAttribute("aria-sort");
  if (actual !== expectedDirection) {
    throw new Error(
      `${fieldName} header aria-sort was ${JSON.stringify(actual)}, expected ${JSON.stringify(expectedDirection)}`,
    );
  }
}

async function toggleDarkMode(page) {
  const isDark = await page.evaluate(
    () => localStorage.getItem("dashboard-dark-mode") === "true",
  );
  const button = page.getByRole("button", {
    name: isDark ? "Switch to light mode" : "Switch to dark mode",
    exact: true,
  });
  await button.click();
  await page.waitForFunction(
    (previous) =>
      localStorage.getItem("dashboard-dark-mode") === String(!previous),
    isDark,
  );
  await nextPaint(page);
}

async function assertMobileSortDirection(page) {
  const rows = page.getByTestId("observer-row");
  const before = (await rows.first().innerText()).trim();
  const ascendingButton = page.getByRole("button", {
    name: "Sort ascending",
    exact: true,
  });
  await ascendingButton.click();
  await page
    .getByRole("button", { name: "Sort descending", exact: true })
    .waitFor({ state: "visible", timeout: 5000 });
  await nextPaint(page);
  const after = (await rows.first().innerText()).trim();
  if (before === after) {
    throw new Error(
      "mobile direction toggle did not change the first observer",
    );
  }
}

async function focusByKeyboard(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const baseline = await locator.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      outline: style.outline,
    };
  });
  await page.evaluate(() => {
    globalThis.document.body.tabIndex = -1;
    globalThis.document.body.focus();
  });
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await locator.evaluate(
        (element) =>
          globalThis.document.activeElement === element ||
          element.contains(globalThis.document.activeElement),
      )
    ) {
      const focused = await locator.evaluate((element) => {
        const active = globalThis.document.activeElement;
        const target = element.contains(active) ? active : element;
        const style = globalThis.getComputedStyle(target);
        return {
          focusVisible: target.matches(":focus-visible"),
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          outline: style.outline,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth || "0"),
        };
      });
      const visibleIndication =
        (focused.outlineStyle !== "none" && focused.outlineWidth > 0) ||
        focused.boxShadow !== "none" ||
        focused.backgroundColor !== baseline.backgroundColor ||
        focused.outline !== baseline.outline;
      if (!focused.focusVisible || !visibleIndication) {
        throw new Error(
          `keyboard focus lacks a visible indication: ${JSON.stringify({ baseline, focused })}`,
        );
      }
      return;
    }
  }
  throw new Error("target was not reachable within 80 Tab presses");
}

async function assertKeyboardDialogCycle(page, text, key) {
  const record = await stableRecord(page, "observer-row", text);
  await focusByKeyboard(page, record);
  await page.keyboard.press(key);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const dialogName = await dialog.getAttribute("aria-labelledby");
  if (
    !dialogName ||
    !(await page.locator(`[id=${JSON.stringify(dialogName)}]`).count())
  ) {
    throw new Error("opened dialog has no resolvable aria-labelledby name");
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  await waitForUiSettled(page);
  const restored = await record.evaluate(
    (element) =>
      globalThis.document.activeElement === element ||
      element.contains(globalThis.document.activeElement),
  );
  if (!restored) {
    throw new Error(
      `focus was not restored after ${key} activation and Escape`,
    );
  }
}

async function assertPageIntegrity(page, label) {
  const result = await page.evaluate(() => {
    const issues = [];
    const tolerance = 1;
    const visible = (element) => {
      const style = globalThis.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.closest('[aria-hidden="true"]')
      );
    };
    const descriptor = (element) => {
      const text = (element.textContent || "").trim().replace(/\s+/g, " ");
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || undefined,
        role: element.getAttribute("role") || undefined,
        label: element.getAttribute("aria-label") || undefined,
        text: text.slice(0, 80) || undefined,
      };
    };
    const rect = (element) => element?.getBoundingClientRect();
    const overlaps = (a, b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    const withinViewport = (box) =>
      box.left >= -tolerance &&
      box.top >= -tolerance &&
      box.right <= globalThis.innerWidth + tolerance &&
      box.bottom <= globalThis.innerHeight + tolerance;
    const accessibleName = (element) => {
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const value = labelledBy
          .split(/\s+/)
          .map(
            (id) =>
              globalThis.document.getElementById(id)?.textContent?.trim() || "",
          )
          .filter(Boolean)
          .join(" ");
        if (value) return value;
      }
      if (element.id) {
        const label = Array.from(
          globalThis.document.querySelectorAll("label"),
        ).find((candidate) => candidate.htmlFor === element.id);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const wrappingLabel = element.closest("label")?.textContent?.trim();
      if (wrappingLabel) return wrappingLabel;
      const alt = element.getAttribute("alt")?.trim();
      if (alt) return alt;
      const title = element.getAttribute("title")?.trim();
      if (title) return title;
      const value = element.getAttribute("value")?.trim();
      if (value && ["button", "submit", "reset"].includes(element.type)) {
        return value;
      }
      return element.textContent?.trim() || "";
    };
    const parseColor = (value) => {
      if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
      const match = value.match(
        /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
      );
      if (!match) return null;
      const alpha = match[4]?.endsWith("%")
        ? Number.parseFloat(match[4]) / 100
        : Number.parseFloat(match[4] ?? "1");
      return {
        r: Number.parseFloat(match[1]),
        g: Number.parseFloat(match[2]),
        b: Number.parseFloat(match[3]),
        a: alpha,
      };
    };
    const composite = (foreground, background) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = (color) => {
      const linear = [color.r, color.g, color.b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrastRatio = (first, second) => {
      const lighter = Math.max(luminance(first), luminance(second));
      const darker = Math.min(luminance(first), luminance(second));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const roundedColor = (color) =>
      `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
    const contrastContext = (element, usePlaceholderStyle) => {
      const chain = [];
      for (let current = element; current; current = current.parentElement) {
        chain.push(current);
      }
      chain.reverse();

      let background = { r: 255, g: 255, b: 255, a: 1 };
      const backgroundLayers = [];
      for (const current of chain) {
        const style = globalThis.getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity || "1");
        if (opacity < 0.999) return { excluded: "translucent ancestor" };
        if (
          style.backgroundImage !== "none" ||
          style.mixBlendMode !== "normal" ||
          style.backgroundBlendMode !== "normal" ||
          style.filter !== "none" ||
          style.backdropFilter !== "none"
        ) {
          return { excluded: "image, blend, or filter background" };
        }
        const layer = parseColor(style.backgroundColor);
        if (!layer) {
          return {
            error: `unresolved background color ${JSON.stringify(style.backgroundColor)}`,
          };
        }
        if (layer.a > 0) {
          background = composite(layer, background);
          backgroundLayers.push({
            element: descriptor(current),
            css: style.backgroundColor,
          });
        }
      }

      const style = usePlaceholderStyle
        ? globalThis.getComputedStyle(element, "::placeholder")
        : globalThis.getComputedStyle(element);
      const textFill = style.webkitTextFillColor;
      const foregroundCss =
        textFill && textFill !== "transparent" ? textFill : style.color;
      const foreground = parseColor(foregroundCss);
      if (!foreground) {
        return {
          error: `unresolved foreground color ${JSON.stringify(foregroundCss)}`,
        };
      }
      const placeholderOpacity = usePlaceholderStyle
        ? Number.parseFloat(style.opacity || "1")
        : 1;
      if (!Number.isFinite(placeholderOpacity)) {
        return {
          error: `unresolved placeholder opacity ${JSON.stringify(style.opacity)}`,
        };
      }
      const resolvedForeground = usePlaceholderStyle
        ? {
            ...foreground,
            a: foreground.a * placeholderOpacity,
          }
        : foreground;
      return {
        background,
        backgroundLayers: backgroundLayers.slice(-4),
        foreground: composite(resolvedForeground, background),
        foregroundCss,
        ...(usePlaceholderStyle && { placeholderOpacity }),
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
      };
    };

    for (const root of [
      globalThis.document.documentElement,
      globalThis.document.body,
      globalThis.document.querySelector("#root"),
    ]) {
      if (root && root.scrollWidth - root.clientWidth > tolerance) {
        issues.push(
          `${root.id ? `#${root.id}` : root.tagName.toLowerCase()} horizontal overflow ${root.scrollWidth - root.clientWidth}px`,
        );
      }
    }

    const componentSelector = [
      "main",
      "main > div",
      ".MuiCard-root",
      ".MuiPaper-root:not(.MuiTableContainer-root)",
      ".MuiTableContainer-root",
      ".MuiDialog-paper",
      ".MuiDialogContent-root",
      ".MuiDrawer-paper",
      ".MuiAppBar-root .MuiToolbar-root",
    ].join(",");
    for (const element of globalThis.document.querySelectorAll(
      componentSelector,
    )) {
      if (
        visible(element) &&
        element.scrollWidth - element.clientWidth > tolerance
      ) {
        issues.push(
          `component horizontal overflow ${element.scrollWidth - element.clientWidth}px ${JSON.stringify(descriptor(element))}`,
        );
      }
    }

    const ids = new Map();
    for (const element of globalThis.document.querySelectorAll("[id]")) {
      ids.set(element.id, (ids.get(element.id) || 0) + 1);
    }
    const duplicateIds = [...ids.entries()].filter(([, count]) => count > 1);
    if (duplicateIds.length > 0) {
      issues.push(`duplicate IDs ${JSON.stringify(duplicateIds)}`);
    }

    const interactiveSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([type='hidden']):not([disabled])",
      "select:not([disabled])",
      "[role='button']:not([aria-disabled='true'])",
      "[role='combobox']:not([aria-disabled='true'])",
      "[role='link']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const unnamed = [];
    for (const element of new Set(
      globalThis.document.querySelectorAll(interactiveSelector),
    )) {
      if (!visible(element)) continue;
      if (!accessibleName(element)) unnamed.push(descriptor(element));
    }
    if (unnamed.length > 0) {
      issues.push(
        `interactive controls without accessible names ${JSON.stringify(unnamed)}`,
      );
    }

    if (globalThis.matchMedia("(pointer: coarse)").matches) {
      const undersized = [];
      const measuredTargets = new Set();
      for (const element of new Set(
        globalThis.document.querySelectorAll(interactiveSelector),
      )) {
        if (!visible(element)) continue;
        if (element.matches("tr, [role='row'], .MuiTableSortLabel-root"))
          continue;
        if (
          element.closest(".MuiTableSortLabel-root, .maplibregl-ctrl-attrib")
        ) {
          continue;
        }
        const target =
          element.matches("input, select, [role='combobox']") &&
          element.closest(".MuiInputBase-root")
            ? element.closest(".MuiInputBase-root")
            : element;
        if (measuredTargets.has(target)) continue;
        measuredTargets.add(target);
        const box = target.getBoundingClientRect();
        if (box.width < 44 - tolerance || box.height < 44 - tolerance) {
          undersized.push({
            ...descriptor(element),
            width: Math.round(box.width),
            height: Math.round(box.height),
          });
        }
      }
      if (undersized.length > 0) {
        issues.push(`touch targets below 44px ${JSON.stringify(undersized)}`);
      }
    }

    const contrastCandidates = new Map();
    const textWalker = globalThis.document.createTreeWalker(
      globalThis.document.body,
      globalThis.NodeFilter.SHOW_TEXT,
    );
    for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element) continue;
      const existing = contrastCandidates.get(element) || [];
      existing.push(text);
      contrastCandidates.set(element, existing);
    }
    for (const control of globalThis.document.querySelectorAll(
      "input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input[type='password'], input[type='number'], input[type='button'], input[type='submit'], input[type='reset'], textarea, select",
    )) {
      const content =
        control.value ||
        control.getAttribute("placeholder") ||
        accessibleName(control);
      if (content?.trim() && !contrastCandidates.has(control)) {
        contrastCandidates.set(control, [content.trim()]);
      }
    }

    const contrastFailures = [];
    let contrastFailureCount = 0;
    for (const [element, textParts] of contrastCandidates) {
      if (!visible(element)) continue;
      if (
        element.closest(
          "script, style, template, noscript, svg, canvas, img, picture, video, audio, .maplibregl-map",
        ) ||
        element.closest(
          "button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled='true'], .Mui-disabled",
        )
      ) {
        continue;
      }
      const range = globalThis.document.createRange();
      if (element.childNodes.length > 0) {
        range.selectNodeContents(element);
        const hasVisibleTextBox = Array.from(range.getClientRects()).some(
          (box) => box.width > 0 && box.height > 0,
        );
        if (!hasVisibleTextBox && !element.matches("input, textarea, select")) {
          continue;
        }
      }

      const usePlaceholderStyle =
        element.matches("input, textarea") &&
        !element.value &&
        Boolean(element.getAttribute("placeholder")?.trim());
      const context = contrastContext(element, usePlaceholderStyle);
      if (context.excluded) continue;
      if (context.error) {
        contrastFailureCount += 1;
        if (contrastFailures.length < 30) {
          contrastFailures.push({
            ...descriptor(element),
            text: textParts.join(" ").slice(0, 120),
            error: context.error,
          });
        }
        continue;
      }

      const largeText =
        context.fontSize >= 24 ||
        (context.fontSize >= 18.6667 && context.fontWeight >= 700);
      const requiredRatio = largeText ? 3 : 4.5;
      const actualRatio = contrastRatio(context.foreground, context.background);
      if (actualRatio + 0.001 < requiredRatio) {
        contrastFailureCount += 1;
        if (contrastFailures.length < 30) {
          contrastFailures.push({
            ...descriptor(element),
            text: textParts.join(" ").slice(0, 120),
            foregroundCss: context.foregroundCss,
            ...(context.placeholderOpacity !== undefined && {
              placeholderOpacity: context.placeholderOpacity,
            }),
            resolvedForeground: roundedColor(context.foreground),
            effectiveOpaqueBackground: roundedColor(context.background),
            backgroundLayers: context.backgroundLayers,
            fontSizePx: context.fontSize,
            fontWeight: context.fontWeight,
            classification: largeText ? "large" : "normal",
            actualRatio: Number(actualRatio.toFixed(2)),
            requiredRatio,
          });
        }
      }
    }
    if (contrastFailureCount > 0) {
      issues.push(
        `computed text contrast below WCAG threshold (${contrastFailureCount} failures; showing ${contrastFailures.length}) ${JSON.stringify(contrastFailures)}`,
      );
    }

    const appBar = Array.from(
      globalThis.document.querySelectorAll(".MuiAppBar-root"),
    ).find(visible);
    const main = globalThis.document.querySelector("main");
    const mainContent = main?.firstElementChild;
    if (appBar) {
      const appBarRect = rect(appBar);
      if (!withinViewport(appBarRect)) issues.push("app bar escapes viewport");
      if (
        mainContent &&
        visible(mainContent) &&
        globalThis.scrollY <= tolerance
      ) {
        const contentRect = rect(mainContent);
        if (contentRect.top < appBarRect.bottom - tolerance) {
          issues.push("main content overlaps fixed app bar");
        }
      }
    }
    if (main && visible(main)) {
      const mainRect = rect(main);
      if (
        mainRect.left < -tolerance ||
        mainRect.right > globalThis.innerWidth + tolerance
      ) {
        issues.push("main escapes viewport horizontally");
      }
    }

    const drawer = Array.from(
      globalThis.document.querySelectorAll(".MuiDrawer-paper"),
    ).find(visible);
    if (drawer) {
      const drawerRect = rect(drawer);
      if (!withinViewport(drawerRect)) issues.push("drawer escapes viewport");
      if (appBar && overlaps(drawerRect, rect(appBar))) {
        issues.push("drawer overlaps app bar");
      }
      const permanent = drawer.closest(".MuiDrawer-docked") !== null;
      if (permanent && main && overlaps(drawerRect, rect(main))) {
        issues.push("permanent drawer overlaps main");
      }
    }

    for (const dialog of Array.from(
      globalThis.document.querySelectorAll('.MuiDialog-paper[role="dialog"]'),
    ).filter(visible)) {
      const dialogRect = rect(dialog);
      if (!withinViewport(dialogRect)) issues.push("dialog escapes viewport");
      if (dialog.scrollWidth - dialog.clientWidth > tolerance) {
        issues.push("dialog has horizontal overflow");
      }
      const close = dialog.querySelector('button[aria-label="Close"]');
      if (!close || !visible(close) || !withinViewport(rect(close))) {
        issues.push("dialog close control is missing or outside viewport");
      }
      const labelledBy = dialog.getAttribute("aria-labelledby");
      if (
        !labelledBy ||
        !globalThis.document.getElementById(labelledBy)?.textContent?.trim()
      ) {
        issues.push("dialog lacks a resolvable accessible name");
      }
    }

    return issues;
  });
  if (result.length > 0) {
    throw new Error(`${label}\n  - ${result.join("\n  - ")}`);
  }
}

async function auditAndCapture(page, label, name, options = {}) {
  await recordCheck(label, () => assertPageIntegrity(page, label));
  await screenshot(page, name, options);
}

async function waitForMapReady(page) {
  await page
    .getByText("Loading map…", { exact: true })
    .waitFor({ state: "hidden", timeout: 12000 });
  await nextPaint(page);
}

async function waitForMapCanvasStable(page) {
  const canvas = page.locator(".maplibregl-canvas:visible").first();
  if ((await canvas.count()) === 0) return;
  let previous;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextPaint(page);
    const current = await canvas.screenshot();
    if (previous?.equals(current)) return;
    previous = current;
  }
  throw new Error("map canvas did not become stable within 20 rendered frames");
}

function refreshedMapSnapshot(snapshot) {
  const adverts = snapshot.meshcoreIo?.map?.advertsLast7Days ?? [];
  const selected = adverts.find(
    (advert) => advert.nodeName === REQUIRED_FIXTURES.mapAdvert,
  );
  if (!selected) {
    throw new Error(
      `Cannot build refreshed map fixture without ${JSON.stringify(REQUIRED_FIXTURES.mapAdvert)}`,
    );
  }

  const refreshed = {
    ...selected,
    observerName: "Refreshed observer from API",
    workerInstanceId: "ReviewBroker-refreshed-worker",
    at: selected.at + 1_000,
  };
  const others = adverts.filter(
    (advert) => advert.requestId !== selected.requestId,
  );
  const reordered = [others[0], refreshed, ...others.slice(1)].filter(Boolean);
  return {
    ...snapshot,
    generatedAt: snapshot.generatedAt + 1_000,
    meshcoreIo: {
      ...snapshot.meshcoreIo,
      map: { advertsLast7Days: reordered },
    },
  };
}

async function assertSelectedAdvert(page, expected) {
  const list = page.getByRole("list", {
    name: "MeshCore.io adverts with coordinates",
    exact: true,
  });
  const button = list.getByRole("button", {
    name: new RegExp(`^Select advert ${REQUIRED_FIXTURES.mapAdvert};`),
  });
  await button.waitFor({ state: "visible", timeout: 5000 });
  const pressed = await button.getAttribute("aria-pressed");
  if (pressed !== "true") {
    throw new Error(
      `${REQUIRED_FIXTURES.mapAdvert} aria-pressed was ${JSON.stringify(pressed)}, expected "true"`,
    );
  }

  const listPaper = list.locator(
    "xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]",
  );
  const details = listPaper.locator(
    "xpath=preceding-sibling::*[contains(@class, 'MuiPaper-root')][1]",
  );
  await details.waitFor({ state: "visible", timeout: 5000 });
  const detailText = await details.innerText();
  for (const value of [
    expected.nodeName,
    expected.advertType,
    expected.observerName,
    `Request ID: ${expected.requestId}`,
    `Node key: ${expected.nodePublicKey}`,
    `Worker: ${expected.workerInstanceId}`,
  ]) {
    if (!detailText.includes(value)) {
      throw new Error(
        `Selected advert details are missing ${JSON.stringify(value)}: ${JSON.stringify(detailText)}`,
      );
    }
  }
  return { button, details };
}

async function assertCompleteAccessibleAdvertList(page, expectedAdverts) {
  const list = page.getByRole("list", {
    name: "MeshCore.io adverts with coordinates",
    exact: true,
  });
  await list.waitFor({ state: "visible", timeout: 5000 });
  const advertButtons = list.getByRole("button");
  const actualCount = await advertButtons.count();
  if (actualCount !== expectedAdverts.length) {
    throw new Error(
      `Post-ready map resource failure changed the complete accessible advert count: expected ${expectedAdverts.length}, found ${actualCount}`,
    );
  }
  const labels = await advertButtons.evaluateAll((buttons) =>
    buttons.map((button) => ({
      disabled: button.disabled,
      label: button.getAttribute("aria-label") || "",
    })),
  );
  for (const advert of expectedAdverts) {
    const item = labels.find((candidate) =>
      candidate.label.includes(`request ${advert.requestId};`),
    );
    if (!item || item.disabled) {
      throw new Error(
        `Complete accessible advert list is missing an enabled item for request ${JSON.stringify(advert.requestId)}`,
      );
    }
  }
  return list;
}

async function captureMapSelectionRefresh(browser, snapshot) {
  const initialAdverts = snapshot.meshcoreIo?.map?.advertsLast7Days ?? [];
  const initialAdvert = initialAdverts.find(
    (advert) => advert.nodeName === REQUIRED_FIXTURES.mapAdvert,
  );
  if (!initialAdvert) {
    throw new Error(
      `Dashboard demo fixtures missing map advert ${JSON.stringify(REQUIRED_FIXTURES.mapAdvert)}`,
    );
  }
  const refreshedSnapshot = refreshedMapSnapshot(snapshot);
  const refreshedAdvert =
    refreshedSnapshot.meshcoreIo.map.advertsLast7Days.find(
      (advert) => advert.requestId === initialAdvert.requestId,
    );
  if (!refreshedAdvert) {
    throw new Error("Refreshed map fixture lost the selected advert");
  }
  let requestCount = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  const auditPage = await newAuditPage(browser, {
    label: "map advert refresh",
    width: 1200,
    height: 900,
    interceptApi: async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await route.fulfill({ status: 200, json: snapshot });
        return;
      }
      await refreshGate;
      await route.fulfill({ status: 200, json: refreshedSnapshot });
    },
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await openView(page, "meshcoreio");
    await waitForMapReady(page);
    const list = page.getByRole("list", {
      name: "MeshCore.io adverts with coordinates",
      exact: true,
    });
    const namedAdvert = list.getByRole("button", {
      name: new RegExp(`^Select advert ${REQUIRED_FIXTURES.mapAdvert};`),
    });
    await namedAdvert.waitFor({ state: "visible", timeout: 5000 });
    await namedAdvert.click();
    await nextPaint(page);
    await assertSelectedAdvert(page, initialAdvert);
    await auditAndCapture(
      page,
      "map named advert selected",
      "desktop-meshcoreio-named-advert-selected",
    );

    const refreshResponse = page.waitForResponse(
      (response) =>
        requestCount >= 2 &&
        new URL(response.url()).pathname === "/api/dashboard" &&
        response.request().method() === "GET",
      { timeout: 7000 },
    );
    releaseRefresh();
    const response = await refreshResponse;
    if (!response.ok()) {
      throw new Error(`Map refresh returned HTTP ${response.status()}`);
    }
    await page.waitForFunction(
      ({ nodeName, workerInstanceId }) => {
        const list = globalThis.document.querySelector(
          '[aria-label="MeshCore.io adverts with coordinates"]',
        );
        const selected = Array.from(
          list?.querySelectorAll('button[aria-pressed="true"]') ?? [],
        ).find((button) => button.textContent?.includes(nodeName));
        return (
          selected?.textContent?.includes(workerInstanceId) &&
          selected.getBoundingClientRect().height > 0
        );
      },
      {
        nodeName: refreshedAdvert.nodeName,
        workerInstanceId: refreshedAdvert.workerInstanceId,
      },
      { timeout: 5000 },
    );
    const { button, details } = await assertSelectedAdvert(
      page,
      refreshedAdvert,
    );
    if (!(await button.isVisible()) || !(await details.isVisible())) {
      throw new Error(
        "Refreshed selected advert list item and details must remain visible",
      );
    }
    await auditAndCapture(
      page,
      "map selected advert remains current after reordered refresh",
      "desktop-meshcoreio-named-advert-refreshed",
    );
  } finally {
    releaseRefresh();
    await closeAuditPage(auditPage);
  }
}

async function captureMapResourceFailure(browser, snapshot) {
  const auditPage = await newAuditPage(browser, {
    label: "synthetic map resource failure",
    width: 1200,
    height: 900,
    failMapStyle: true,
    expectedFailedResponseUrls: [mapStylePattern],
    interceptApi: (route) => route.fulfill({ status: 200, json: snapshot }),
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await openView(page, "meshcoreio");

    const fallback = page
      .getByRole("alert")
      .filter({ hasText: "Map could not be loaded:" });
    await fallback.waitFor({ state: "visible", timeout: 5000 });
    const fallbackText = (await fallback.innerText()).trim();
    if (
      !fallbackText.includes("complete advert list below instead") ||
      fallbackText.length < 40
    ) {
      throw new Error(
        `Map failure fallback did not provide actionable text: ${JSON.stringify(fallbackText)}`,
      );
    }
    const fallbackBox = await fallback.boundingBox();
    if (!fallbackBox || fallbackBox.width < 100 || fallbackBox.height < 20) {
      throw new Error(
        `Map failure fallback has no meaningful visible area: ${JSON.stringify(fallbackBox)}`,
      );
    }
    const fallbackCoverage = await fallback.evaluate((element) => {
      const overlay = element.parentElement;
      const mapFrame = overlay?.parentElement;
      if (!overlay || !mapFrame) return null;
      const overlayBox = overlay.getBoundingClientRect();
      const frameBox = mapFrame.getBoundingClientRect();
      const frameStyle = globalThis.getComputedStyle(mapFrame);
      return {
        overlay: {
          width: overlayBox.width,
          height: overlayBox.height,
        },
        frame: { width: frameBox.width, height: frameBox.height },
        frameBorder: {
          horizontal:
            Number.parseFloat(frameStyle.borderLeftWidth) +
            Number.parseFloat(frameStyle.borderRightWidth),
          vertical:
            Number.parseFloat(frameStyle.borderTopWidth) +
            Number.parseFloat(frameStyle.borderBottomWidth),
        },
        overlayBackground: globalThis.getComputedStyle(overlay).backgroundColor,
      };
    });
    if (
      !fallbackCoverage ||
      fallbackCoverage.overlay.width <
        fallbackCoverage.frame.width -
          fallbackCoverage.frameBorder.horizontal -
          1 ||
      fallbackCoverage.overlay.height <
        fallbackCoverage.frame.height -
          fallbackCoverage.frameBorder.vertical -
          1 ||
      fallbackCoverage.overlayBackground === "rgba(0, 0, 0, 0)" ||
      fallbackCoverage.overlayBackground === "transparent"
    ) {
      throw new Error(
        `Map failure did not replace the blank map frame with an opaque fallback: ${JSON.stringify(fallbackCoverage)}`,
      );
    }

    const list = page.getByRole("list", {
      name: "MeshCore.io adverts with coordinates",
      exact: true,
    });
    await list.waitFor({ state: "visible", timeout: 5000 });
    const advertButtons = list.getByRole("button");
    const advertCount = await advertButtons.count();
    if (advertCount === 0) {
      throw new Error(
        "Map resource failure left no accessible advert fallback items",
      );
    }
    const namedAdvert = list.getByRole("button", {
      name: new RegExp(`^Select advert ${REQUIRED_FIXTURES.mapAdvert};`),
    });
    await namedAdvert.waitFor({ state: "visible", timeout: 5000 });
    await namedAdvert.click();
    await nextPaint(page);
    const expectedAdvert = snapshot.meshcoreIo.map.advertsLast7Days.find(
      (advert) => advert.nodeName === REQUIRED_FIXTURES.mapAdvert,
    );
    if (!expectedAdvert) {
      throw new Error("Synthetic map failure snapshot lost the named advert");
    }
    await assertSelectedAdvert(page, expectedAdvert);
    if (!(await fallback.isVisible()) || !(await list.isVisible())) {
      throw new Error(
        "Map resource failure must retain both the visible fallback and accessible advert list",
      );
    }
    await auditAndCapture(
      page,
      "synthetic map resource failure fallback and advert list",
      "state-map-resource-failure",
    );
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function capturePostReadyMapResourceFailure(browser, snapshot) {
  const expectedAdverts = snapshot.meshcoreIo?.map?.advertsLast7Days ?? [];
  const auditPage = await newAuditPage(browser, {
    label: "synthetic post-ready map resource failure",
    width: 1200,
    height: 900,
    postReadyMapResourceFailure: true,
    expectedFailedResponseUrls: [syntheticMapTilePattern],
    interceptApi: (route) => route.fulfill({ status: 200, json: snapshot }),
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await openView(page, "meshcoreio");
    await waitForMapReady(page);
    const warningPrefix = "A map resource failed after the map became ready";
    const warning = page.getByRole("alert").filter({ hasText: warningPrefix });
    if ((await warning.count()) !== 0) {
      throw new Error(
        "Post-ready map warning appeared before the synthetic tile failure was enabled",
      );
    }
    await assertCompleteAccessibleAdvertList(page, expectedAdverts);

    auditPage.enablePostReadyMapResourceFailure();
    const failedTileResponse = page.waitForResponse(
      (response) =>
        syntheticMapTilePattern.test(response.url()) &&
        response.status() === 503,
      { timeout: 5000 },
    );
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await failedTileResponse;
    await warning.waitFor({ state: "visible", timeout: 5000 });
    const warningText = (await warning.innerText()).trim().replace(/\s+/g, " ");
    if (
      !warningText.startsWith(`${warningPrefix}:`) ||
      !warningText.includes(
        "Use the complete advert list below if map data is unavailable.",
      )
    ) {
      throw new Error(
        `Unexpected post-ready map resource warning: ${JSON.stringify(warningText)}`,
      );
    }

    const list = await assertCompleteAccessibleAdvertList(
      page,
      expectedAdverts,
    );
    const expectedAdvert = expectedAdverts.find(
      (advert) => advert.nodeName === REQUIRED_FIXTURES.mapAdvert,
    );
    if (!expectedAdvert) {
      throw new Error(
        "Synthetic post-ready map failure snapshot lost the named advert",
      );
    }
    const namedAdvert = list.getByRole("button", {
      name: new RegExp(`^Select advert ${REQUIRED_FIXTURES.mapAdvert};`),
    });
    await namedAdvert.click();
    await nextPaint(page);
    await assertSelectedAdvert(page, expectedAdvert);
    if (!(await warning.isVisible()) || !(await list.isVisible())) {
      throw new Error(
        "Post-ready map resource warning and complete advert list must remain visible after selection",
      );
    }
    await auditAndCapture(
      page,
      "post-ready map resource warning and complete advert list",
      "state-map-post-ready-resource-failure",
    );
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function captureDesktop(browser) {
  const auditPage = await newAuditPage(browser, {
    label: "desktop",
    width: 1440,
    height: 1100,
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    const snapshot = await readAndValidateSeedData(page);
    await auditAndCapture(page, "desktop overview", "desktop-overview");

    await openView(page, "observers");
    await auditAndCapture(page, "desktop observers", "desktop-observers");
    await recordCheck("desktop observer sort descending", () =>
      clickSortLabel(page, "Observer", "descending"),
    );
    await screenshot(page, "desktop-observers-sort-descending");
    await recordCheck("desktop observer sort ascending", () =>
      clickSortLabel(page, "Observer", "ascending"),
    );
    await screenshot(page, "desktop-observers-sort-ascending");

    await recordCheck("observer row Enter/Escape/focus restoration", () =>
      assertKeyboardDialogCycle(page, REQUIRED_FIXTURES.observer, "Enter"),
    );
    await recordCheck("observer row Space/Escape/focus restoration", () =>
      assertKeyboardDialogCycle(page, REQUIRED_FIXTURES.observer, "Space"),
    );

    await openRecord(page, "observer-row", REQUIRED_FIXTURES.observer);
    await auditAndCapture(
      page,
      "desktop observer dialog",
      "desktop-observer-dialog",
      { fullPage: false },
    );
    await page.getByText(/Recent messages \(/).scrollIntoViewIfNeeded();
    await nextPaint(page);
    await screenshot(page, "desktop-observer-dialog-scrolled", {
      fullPage: false,
    });
    await closeDialog(page);

    await openRecord(page, "observer-row", REQUIRED_FIXTURES.longObserver);
    await auditAndCapture(
      page,
      "desktop long observer dialog",
      "desktop-observer-dialog-long-content",
      { fullPage: false },
    );
    await closeDialog(page);

    await openView(page, "bans");
    await auditAndCapture(page, "desktop bans", "desktop-bans");
    await recordCheck("desktop ban sort descending", () =>
      clickSortLabel(page, "Observer", "descending"),
    );
    await screenshot(page, "desktop-bans-sort-descending");
    await recordCheck("desktop ban sort ascending", () =>
      clickSortLabel(page, "Observer", "ascending"),
    );
    await screenshot(page, "desktop-bans-sort-ascending");
    await openRecord(page, "ban-row", REQUIRED_FIXTURES.ban);
    await auditAndCapture(
      page,
      "desktop ban dialog",
      "desktop-ban-dialog-iata",
      { fullPage: false },
    );
    await closeDialog(page);

    await openView(page, "subscribers");
    await auditAndCapture(page, "desktop subscribers", "desktop-subscribers");
    await recordCheck("desktop subscriber sort descending", () =>
      clickSortLabel(page, "Username", "descending"),
    );
    await screenshot(page, "desktop-subscribers-sort-descending");
    await openRecord(page, "subscriber-row", REQUIRED_FIXTURES.subscriber);
    await auditAndCapture(
      page,
      "desktop subscriber dialog",
      "desktop-subscriber-dialog",
      { fullPage: false },
    );
    await closeDialog(page);

    await openView(page, "meshcoreio");
    await waitForMapReady(page);
    await auditAndCapture(page, "desktop MeshCore.io", "desktop-meshcoreio");
    const fitButton = page.getByTestId("fit-adverts");
    await fitButton.click();
    await recordCheck("map fit observable stability", () =>
      waitForMapCanvasStable(page),
    );
    await screenshot(page, "desktop-meshcoreio-map-fit");

    await toggleDarkMode(page);
    for (const route of DARK_ROUTES) {
      await openView(page, route);
      if (route === "meshcoreio") await waitForMapReady(page);
      await auditAndCapture(
        page,
        `desktop dark ${route}`,
        `desktop-${route}-dark`,
      );
    }
    await toggleDarkMode(page);
    return snapshot;
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function captureMobile(browser) {
  const auditPage = await newAuditPage(browser, {
    label: "mobile",
    width: 390,
    height: 844,
    isMobile: true,
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await auditAndCapture(page, "mobile overview", "mobile-overview");
    await openMobileNav(page);
    await auditAndCapture(
      page,
      "mobile navigation drawer",
      "mobile-navigation-drawer",
      { fullPage: false },
    );
    await openView(page, "observers");
    await auditAndCapture(page, "mobile observers", "mobile-observers");
    await recordCheck("mobile observer sort direction", () =>
      assertMobileSortDirection(page),
    );
    await auditAndCapture(
      page,
      "mobile observers ascending",
      "mobile-observers-sort-ascending",
    );
    await openRecord(page, "observer-row", REQUIRED_FIXTURES.observer);
    await auditAndCapture(
      page,
      "mobile observer dialog",
      "mobile-observer-dialog",
      { fullPage: false },
    );
    await closeDialog(page);

    await openView(page, "bans");
    await auditAndCapture(page, "mobile bans", "mobile-bans");
    await openRecord(page, "ban-row", REQUIRED_FIXTURES.ban);
    await auditAndCapture(page, "mobile ban dialog", "mobile-ban-dialog", {
      fullPage: false,
    });
    await closeDialog(page);

    await openView(page, "subscribers");
    await stableRecord(page, "subscriber-row", REQUIRED_FIXTURES.subscriber);
    await auditAndCapture(page, "mobile subscribers", "mobile-subscribers");
    await openRecord(page, "subscriber-row", REQUIRED_FIXTURES.subscriber);
    await auditAndCapture(
      page,
      "mobile subscriber dialog",
      "mobile-subscriber-dialog",
      { fullPage: false },
    );
    await closeDialog(page);

    await openView(page, "meshcoreio");
    await waitForMapReady(page);
    await auditAndCapture(page, "mobile MeshCore.io", "mobile-meshcoreio");

    await toggleDarkMode(page);
    for (const route of DARK_ROUTES) {
      await openView(page, route);
      if (route === "meshcoreio") await waitForMapReady(page);
      await auditAndCapture(
        page,
        `mobile dark ${route}`,
        `mobile-${route}-dark`,
      );
    }
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function exerciseAllRoutes(page, label) {
  for (const route of DARK_ROUTES) {
    await openView(page, route);
    if (route === "meshcoreio") await waitForMapReady(page);
    await recordCheck(`${label} ${route}`, () =>
      assertPageIntegrity(page, `${label} ${route}`),
    );
  }
}

async function captureBreakpoints(browser) {
  const breakpoints = [
    { width: 320, height: 720, label: "320-minimum", isMobile: true },
    { width: 600, height: 900, label: "600-small-tablet" },
    { width: 900, height: 900, label: "900-narrow" },
    { width: 1024, height: 900, label: "1024-tablet" },
    { width: 1199, height: 900, label: "1199-below-lg", observers: true },
    { width: 1200, height: 900, label: "1200-lg", observers: true },
    { width: 1600, height: 1000, label: "1600-wide" },
  ];
  for (const breakpoint of breakpoints) {
    const auditPage = await newAuditPage(browser, {
      label: `breakpoint ${breakpoint.label}`,
      width: breakpoint.width,
      height: breakpoint.height,
      isMobile: breakpoint.isMobile ?? false,
    });
    const { page } = auditPage;
    try {
      await waitForDashboard(page);
      await exerciseAllRoutes(page, `${breakpoint.label} all routes`);
      const route = breakpoint.observers ? "observers" : "overview";
      await openView(page, route);
      await auditAndCapture(
        page,
        `${breakpoint.label} ${route}`,
        `responsive-${breakpoint.label}-${route}`,
      );
    } finally {
      await closeAuditPage(auditPage);
    }
  }
}

function longDialogSnapshot(snapshot) {
  const longObserver = snapshot.observers.find(
    (observer) => observer.label === REQUIRED_FIXTURES.longObserver,
  );
  const longBan = snapshot.bans.find(
    (ban) => ban.label === REQUIRED_FIXTURES.ban,
  );
  const longSubscriber = snapshot.subscribers.find(
    (subscriber) => subscriber.username === REQUIRED_FIXTURES.subscriber,
  );
  if (!longObserver || !longBan || !longSubscriber) {
    throw new Error("Cannot build long-dialog snapshot without demo fixtures");
  }

  const longSegment = "pathological-long-value-".repeat(12);
  const subscription = `meshcore/${longSegment}/#`;
  const observerMessages = longObserver.messages.map((message, index) => ({
    ...message,
    topic: `${message.topic}/${longSegment}${index}`,
    subtopic: `${message.subtopic}/${longSegment}${index}`,
  }));
  const subscriptions = [subscription, ...longSubscriber.subscriptions];
  return {
    ...snapshot,
    observers: snapshot.observers.map((observer) =>
      observer.publicKey === longObserver.publicKey
        ? { ...observer, messages: observerMessages }
        : observer,
    ),
    bans: snapshot.bans.map((ban) =>
      ban === longBan
        ? {
            ...ban,
            topic: `${ban.topic}/${longSegment}`,
            deniedUntilText: `Review this complete long denial explanation: ${longSegment}`,
          }
        : ban,
    ),
    subscribers: snapshot.subscribers.map((subscriber) =>
      subscriber.username === longSubscriber.username
        ? {
            ...subscriber,
            subscriptions,
            brokers: subscriber.brokers.map((broker) => ({
              ...broker,
              brokerId: `${broker.brokerId}-${longSegment}`,
              subscriptions,
            })),
            connections: subscriber.connections.map((connection) => ({
              ...connection,
              clientId: `${connection.clientId}-${longSegment}`,
              brokerId: `${connection.brokerId}-${longSegment}`,
              subscriptions,
            })),
          }
        : subscriber,
    ),
  };
}

async function captureLongDialogsAtMobileWidths(browser, snapshot) {
  const longSnapshot = longDialogSnapshot(snapshot);
  for (const { width, height } of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
  ]) {
    const auditPage = await newAuditPage(browser, {
      label: `long content ${width}`,
      width,
      height,
      isMobile: true,
      interceptApi: (route) =>
        route.fulfill({ status: 200, json: longSnapshot }),
    });
    const { page } = auditPage;
    try {
      await waitForDashboard(page);
      await openView(page, "observers");
      await openRecord(page, "observer-row", REQUIRED_FIXTURES.longObserver);
      await auditAndCapture(
        page,
        `long content ${width} observer dialog`,
        `mobile-${width}-long-observer-dialog`,
        { fullPage: false },
      );
      await closeDialog(page);

      await openView(page, "bans");
      await openRecord(page, "ban-row", REQUIRED_FIXTURES.ban);
      await auditAndCapture(
        page,
        `long content ${width} ban dialog`,
        `mobile-${width}-long-ban-dialog`,
        { fullPage: false },
      );
      await closeDialog(page);

      await openView(page, "subscribers");
      await openRecord(page, "subscriber-row", REQUIRED_FIXTURES.subscriber);
      await auditAndCapture(
        page,
        `long content ${width} subscriber dialog`,
        `mobile-${width}-long-subscriber-dialog`,
        { fullPage: false },
      );
      await closeDialog(page);
    } finally {
      await closeAuditPage(auditPage);
    }
  }
}

function emptySnapshot(snapshot) {
  return {
    ...snapshot,
    summary: {
      ...snapshot.summary,
      connectedClients: 0,
      connectedObservers: 0,
      activeBans: 0,
      protectionEventsShown: 0,
      protectionEventsTotal: 0,
      protectionEventsTruncated: false,
      publishesLastMinute: 0,
      messagesPerSecond: 0,
    },
    observers: [],
    recentPublishes: [],
    bans: [],
    subscribers: [],
    meshcoreIo: snapshot.meshcoreIo
      ? {
          ...snapshot.meshcoreIo,
          workers: [],
          history: [],
          map: { advertsLast7Days: [] },
        }
      : snapshot.meshcoreIo,
  };
}

async function captureLoadingState(browser, snapshot) {
  let releaseRequest;
  const gate = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  const auditPage = await newAuditPage(browser, {
    label: "loading state",
    width: 390,
    height: 844,
    isMobile: true,
    interceptApi: async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: snapshot });
    },
  });
  const { page } = auditPage;
  try {
    await page.goto(dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByText("Loading dashboard data…", { exact: true })
      .waitFor({ state: "visible", timeout: 5000 });
    await auditAndCapture(page, "mobile loading", "state-mobile-loading");
    releaseRequest();
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor({ state: "visible", timeout: 5000 });
  } finally {
    releaseRequest();
    await closeAuditPage(auditPage);
  }
}

async function captureEmptyStates(browser, snapshot) {
  const empty = emptySnapshot(snapshot);
  const auditPage = await newAuditPage(browser, {
    label: "empty states",
    width: 390,
    height: 844,
    isMobile: true,
    interceptApi: (route) => route.fulfill({ status: 200, json: empty }),
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await page
      .getByText(/^(?:No observers found\.|No observers have reported yet\.)$/)
      .waitFor();
    await page
      .getByText(
        /^(?:No active bans\.|No protection events were reported in this dashboard snapshot\.)$/,
      )
      .waitFor();
    await page
      .getByText(
        /^(?:No recent publishes\.|No publishes have been reported yet\.)$/,
      )
      .waitFor({ timeout: 5000 });
    await auditAndCapture(page, "empty overview", "state-empty-overview");
    for (const [route, text] of [
      [
        "observers",
        /^(?:No observers match your filters\.|No observers have reported yet\.)$/,
      ],
      ["bans", /^(?:No active bans|No protection events reported)$/],
      [
        "subscribers",
        /^(?:No active subscribers|No subscriber connections reported)$/,
      ],
      [
        "meshcoreio",
        "No adverts with coordinates were reported in the last 7 days.",
      ],
    ]) {
      await openView(page, route);
      await page.getByText(text).waitFor({ state: "visible" });
      await auditAndCapture(page, `empty ${route}`, `state-empty-${route}`);
    }
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function captureFatalError(browser) {
  const auditPage = await newAuditPage(browser, {
    label: "fatal API error",
    width: 390,
    height: 844,
    isMobile: true,
    extraConsoleAllowlist: [
      /^Dashboard: could not update data:/,
      /^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/,
    ],
    interceptApi: (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "intentional screenshot audit failure" }),
      }),
  });
  const { page } = auditPage;
  try {
    await page.goto(dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .getByText(
        /^(?:The dashboard API could not be reached\. Previously loaded data remains visible\.|Dashboard data could not be loaded\. Check the broker connection and try again\.)$/,
      )
      .waitFor({ state: "visible", timeout: 5000 });
    await auditAndCapture(page, "fatal API error", "state-fatal-api-error");
  } finally {
    await closeAuditPage(auditPage);
  }
}

async function captureRefreshWarning(browser, snapshot) {
  let requestCount = 0;
  const auditPage = await newAuditPage(browser, {
    label: "refresh warning",
    width: 1440,
    height: 900,
    extraConsoleAllowlist: [
      /^Dashboard: could not update data:/,
      /^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/,
    ],
    interceptApi: (route) => {
      requestCount += 1;
      return requestCount === 1
        ? route.fulfill({ status: 200, json: snapshot })
        : route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "intentional refresh failure" }),
          });
    },
  });
  const { page } = auditPage;
  try {
    await waitForDashboard(page);
    await page
      .getByText(
        /^(?:The dashboard API could not be reached\. Previously loaded data remains visible\.|Dashboard data could not be refreshed\. Previously loaded data remains visible\.)$/,
      )
      .waitFor({ state: "visible", timeout: 7000 });
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByText(REQUIRED_FIXTURES.observer, { exact: true })
      .first()
      .waitFor({ state: "visible" });
    await auditAndCapture(page, "refresh warning", "state-refresh-warning");
  } finally {
    await closeAuditPage(auditPage);
  }
}

export async function prepareOutputDirectory(directory = outputDir) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const numberedArtifact = entry.name.match(/^\d{2,3}-(.+)\.png$/);
    if (
      entry.isFile() &&
      numberedArtifact &&
      KNOWN_SCREENSHOT_NAMES.has(numberedArtifact[1])
    ) {
      await unlink(path.join(directory, entry.name));
    }
  }
}

async function main() {
  await prepareOutputDirectory();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const snapshot = await captureDesktop(browser);
    await captureMobile(browser);
    await captureMapSelectionRefresh(browser, snapshot);
    await captureMapResourceFailure(browser, snapshot);
    await capturePostReadyMapResourceFailure(browser, snapshot);
    await captureLongDialogsAtMobileWidths(browser, snapshot);
    await captureBreakpoints(browser);
    await captureLoadingState(browser, snapshot);
    await captureEmptyStates(browser, snapshot);
    await captureFatalError(browser);
    await captureRefreshWarning(browser, snapshot);
  } finally {
    await browser.close();
  }

  if (sequence !== DASHBOARD_SCREENSHOT_COVERAGE_COUNT) {
    throw new Error(
      `Dashboard screenshot coverage count was ${sequence}, expected ${DASHBOARD_SCREENSHOT_COVERAGE_COUNT}`,
    );
  }

  console.log(
    `Dashboard screenshot artifacts written to ${outputDir} (${sequence} total):`,
  );
  for (const screenshotPath of screenshotPaths) console.log(screenshotPath);
  console.log(
    "Screenshots are artifacts for human review; no visual inspection was performed.",
  );
  if (auditFailures.length > 0) {
    throw new Error(
      `Objective browser audit failed (${auditFailures.length}):\n- ${auditFailures.join("\n- ")}`,
    );
  }
  console.log(
    "Objective DOM, accessibility, computed contrast, geometry, and interaction audit passed.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
