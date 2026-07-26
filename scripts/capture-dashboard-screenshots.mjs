import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const dashboardUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8080";
const outputDir =
  process.env.DASHBOARD_SCREENSHOT_DIR || path.resolve("dashboard-screenshots");

let seq = 0;
function sn(page, name, options = {}) {
  seq++;
  const padded = String(seq).padStart(2, "0");
  return page.screenshot({
    path: path.join(outputDir, `${padded}-${name}.png`),
    fullPage: true,
    ...options,
  });
}

async function validateSeedData(page) {
  const response = await page.request.get(`${dashboardUrl}/api/dashboard`);
  if (!response.ok())
    throw new Error(`Dashboard API returned ${response.status()}`);
  const data = await response.json();
  if (data.bans.length < 3)
    throw new Error(`Expected at least 3 bans, got ${data.bans.length}`);
  if ((data.meshcoreIo?.map?.advertsLast7Days?.length ?? 0) < 6)
    throw new Error(
      `Expected 6 map adverts, got ${data.meshcoreIo?.map?.advertsLast7Days?.length ?? 0}`,
    );
}

async function waitForDashboard(page) {
  await page.goto(dashboardUrl, { waitUntil: "load", timeout: 30000 });
  await page.locator("#root").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.locator("text=MeshCore MQTT").first().waitFor({
    timeout: 20000,
  });
  await page.waitForTimeout(500);
}

async function assertOverflow(page, label) {
  const result = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    const MIN_TARGET = 24;

    const targetSelector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([type='hidden']):not([disabled]):not([aria-hidden='true'])",
      "select:not([disabled]):not([aria-hidden='true'])",
      "[role='button']",
      "[role='combobox']",
      "[role='link']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    const undersized = Array.from(
      globalThis.document.querySelectorAll(targetSelector),
    )
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = globalThis.getComputedStyle(el);

        const isRendered =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0;

        const isInteractive =
          style.pointerEvents !== "none" &&
          el.getAttribute("aria-hidden") !== "true";

        return (
          isRendered &&
          isInteractive &&
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.height < MIN_TARGET || rect.width < MIN_TARGET)
        );
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          role: el.getAttribute("role") || undefined,
          label: el.getAttribute("aria-label") || undefined,
          text: (el.textContent || "").trim().slice(0, 80),
          class: (typeof el.className === "string" ? el.className : "")
            .split(" ")
            .slice(0, 4)
            .join(" "),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      });

    return { overflow, undersized };
  });

  if (result.overflow > 1) {
    throw new Error(`${label}: ${result.overflow}px horizontal overflow`);
  }
  if (result.undersized.length > 0) {
    throw new Error(
      `${label}: undersized targets ${JSON.stringify(result.undersized)}`,
    );
  }
}

const VIEW_TITLES = {
  overview: "Overview",
  observers: "Observers",
  bans: "Bans",
  subscribers: "Subscribers",
  meshcoreio: "MeshCore.io",
};

async function openView(page, view) {
  const target = page.locator(`[data-nav="${view}"]:visible`).first();
  if ((await target.count()) === 0) {
    throw new Error(
      `Cannot navigate to "${view}": no visible nav target. ` +
        `Current URL: ${page.url()}`,
    );
  }
  await target.click();
  await page.waitForURL(new RegExp(`#${view}`));
  const title = VIEW_TITLES[view];
  await page
    .getByRole("heading", { name: title, exact: true })
    .waitFor({ state: "visible", timeout: 5000 });
}

async function openMobileNav(page) {
  const menuButton = page.getByRole("button", { name: "Open menu" });
  try {
    await menuButton.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(
      `Mobile menu "Open menu" button not visible at ${page.url()}`,
    );
  }
  await menuButton.click();
  await page
    .locator('[data-nav="overview"]:visible')
    .waitFor({ state: "visible", timeout: 5000 });
}

async function openMobileView(page, view) {
  await openMobileNav(page);
  await openView(page, view);
}

async function openFirstRow(page) {
  const row = page.locator("table tbody tr").first();
  await row.waitFor({ state: "visible", timeout: 5000 });
  await row.click();
  await page
    .locator(".MuiDialog-root[role='dialog']")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
}

async function openRowByText(page, text) {
  const row = page.locator("table tbody tr").filter({ hasText: text }).first();
  await row.waitFor({ state: "visible", timeout: 5000 });
  await row.click();
  await page
    .locator(".MuiDialog-root[role='dialog']")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
}

async function closeDialog(page) {
  let safety = 0;
  while (
    (await page.locator('.MuiDialog-root[role="dialog"]').count()) > 0 &&
    safety++ < 10
  ) {
    const btn = page
      .locator('.MuiDialog-root[role="dialog"] button[aria-label="Close"]')
      .first();
    if ((await btn.count()) > 0) await btn.click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    try {
      await page
        .locator('.MuiDialog-root[role="dialog"]')
        .first()
        .waitFor({ state: "hidden", timeout: 3000 });
    } catch {
      // ignore
    }
  }
}

async function clickSortLabel(page, fieldName) {
  const label = page
    .locator("span.MuiTableSortLabel-root")
    .filter({ hasText: fieldName })
    .first();
  await label.waitFor({ state: "visible", timeout: 5000 });
  await label.click();
  await page.waitForTimeout(300);
}

async function toggleDarkMode(page) {
  const isDark = await page.evaluate(
    () => localStorage.getItem("dashboard-dark-mode") === "true",
  );
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const button = page.getByRole("button", { name: label });
  await button.waitFor({ state: "visible", timeout: 5000 });
  await button.click();
  await page.waitForFunction(
    (expected) =>
      localStorage.getItem("dashboard-dark-mode") === String(!expected),
    isDark,
  );
}

async function captureDesktop(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await waitForDashboard(page);
  await validateSeedData(page);

  await assertOverflow(page, "desktop overview");
  await sn(page, "desktop-overview");

  await openView(page, "observers");
  await assertOverflow(page, "desktop observers");
  await sn(page, "desktop-observers");

  await clickSortLabel(page, "Observer");
  await sn(page, "desktop-observers-sorted-observer");

  await clickSortLabel(page, "Last message");
  await sn(page, "desktop-observers-sorted-lastmessage");

  await openRowByText(page, "Stockholm Rooftop");
  await assertOverflow(page, "desktop observer dialog");
  await sn(page, "desktop-observer-dialog", { fullPage: false });

  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("text=Recent messages").scrollIntoViewIfNeeded();
  await sn(page, "desktop-observer-dialog-scrolled", { fullPage: false });

  await closeDialog(page);

  await openRowByText(page, "Very Long Observer");
  await page.waitForTimeout(400);
  await sn(page, "desktop-observer-dialog-longlabel", { fullPage: false });
  await closeDialog(page);

  await openView(page, "bans");
  await assertOverflow(page, "desktop bans");
  await sn(page, "desktop-bans");

  await clickSortLabel(page, "Observer");
  await sn(page, "desktop-bans-sorted");

  await clickSortLabel(page, "Blocks");
  await sn(page, "desktop-bans-sorted-blocks");

  await openFirstRow(page);
  await sn(page, "desktop-ban-dialog", { fullPage: false });
  await closeDialog(page);

  const iataRow = page
    .locator("table tbody tr")
    .filter({ hasText: "Change to STO or GOT" })
    .first();
  await iataRow.waitFor({ state: "visible", timeout: 5000 });
  await iataRow.click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 5000 });
  await sn(page, "desktop-ban-dialog-iata", { fullPage: false });
  await closeDialog(page);

  await openView(page, "subscribers");
  await assertOverflow(page, "desktop subscribers");
  await sn(page, "desktop-subscribers");

  await clickSortLabel(page, "Username");
  await sn(page, "desktop-subscribers-sorted");

  await page
    .locator("table tbody tr")
    .filter({ hasText: "visual-review" })
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  await openFirstRow(page);
  await sn(page, "desktop-subscriber-dialog", { fullPage: false });
  await closeDialog(page);

  await openView(page, "meshcoreio");
  await assertOverflow(page, "desktop meshcoreio");
  await sn(page, "desktop-meshcoreio");

  const mapFitBtn = page.getByTestId("fit-adverts");
  await mapFitBtn.waitFor({ state: "visible", timeout: 5000 });
  await mapFitBtn.click();
  await page.waitForTimeout(600);
  await sn(page, "desktop-meshcoreio-map-fit");

  await toggleDarkMode(page);
  await page.waitForTimeout(500);

  await openView(page, "overview");
  await sn(page, "desktop-overview-darkmode");

  await openView(page, "observers");
  await sn(page, "desktop-observers-darkmode");

  await openView(page, "bans");
  await openFirstRow(page);
  await sn(page, "desktop-ban-dialog-darkmode", { fullPage: false });
  await closeDialog(page);

  await openView(page, "meshcoreio");
  await sn(page, "desktop-meshcoreio-darkmode");

  await toggleDarkMode(page);

  await page.close();
}

async function captureMobile(browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await waitForDashboard(page);

  await assertOverflow(page, "mobile overview");
  await sn(page, "mobile-overview");

  await openMobileNav(page);
  await assertOverflow(page, "mobile nav drawer open");
  await sn(page, "mobile-nav-open", { fullPage: false });
  await openView(page, "observers");
  await assertOverflow(page, "mobile observers");
  await sn(page, "mobile-observers");

  await openRowByText(page, "Stockholm Rooftop");
  await sn(page, "mobile-observer-dialog", { fullPage: false });
  await closeDialog(page);

  await openMobileView(page, "bans");
  await sn(page, "mobile-bans");

  await openFirstRow(page);
  await sn(page, "mobile-ban-dialog", { fullPage: false });
  await closeDialog(page);

  await openMobileView(page, "subscribers");
  await page
    .locator("table tbody tr")
    .filter({ hasText: "visual-review" })
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
  await sn(page, "mobile-subscribers");
  await openFirstRow(page);
  await sn(page, "mobile-subscriber-dialog", { fullPage: false });
  await closeDialog(page);

  await openMobileView(page, "meshcoreio");
  await assertOverflow(page, "mobile meshcoreio");
  await sn(page, "mobile-meshcoreio");

  await toggleDarkMode(page);
  await page.waitForTimeout(500);
  await openMobileView(page, "overview");
  await sn(page, "mobile-overview-darkmode");
  await toggleDarkMode(page);

  await page.close();
}

async function captureBreakpoints(browser) {
  const breakpoints = [
    { width: 320, height: 720, label: "320-minimum" },
    { width: 360, height: 800, label: "360-compact" },
    { width: 600, height: 900, label: "600-sm-break" },
    { width: 720, height: 900, label: "720-narrow-tablet" },
    { width: 800, height: 900, label: "800-compact-tablet" },
    { width: 900, height: 900, label: "900-md-break" },
    { width: 1024, height: 900, label: "1024-tablet" },
    { width: 1280, height: 900, label: "1280-narrow-desktop" },
  ];

  for (const bp of breakpoints) {
    const page = await browser.newPage({
      viewport: { width: bp.width, height: bp.height },
      deviceScaleFactor: 1,
      isMobile: bp.width < 768,
    });
    await waitForDashboard(page);
    await assertOverflow(page, `viewport ${bp.label}`);
    await sn(page, `responsive-${bp.label}`);
    await page.close();
  }
}

async function captureOverflowAtAllViews(browser) {
  const page = await browser.newPage({
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await waitForDashboard(page);

  for (const view of ["observers", "bans", "subscribers", "meshcoreio"]) {
    await openMobileView(page, view);
    await assertOverflow(page, `mobile narrow: ${view}`);
  }
  await page.close();
}

async function validateResponsiveWidths(browser) {
  for (const viewport of [
    { width: 320, height: 720, label: "minimum mobile" },
    { width: 360, height: 800, label: "compact mobile" },
    { width: 721, height: 900, label: "narrow tablet" },
    { width: 800, height: 900, label: "compact tablet" },
  ]) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: viewport.width < 600,
    });
    await waitForDashboard(page);
    await assertOverflow(page, viewport.label);
    await page.close();
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    await captureDesktop(browser);
    await captureMobile(browser);
    await captureBreakpoints(browser);
    await captureOverflowAtAllViews(browser);
    await validateResponsiveWidths(browser);
  } finally {
    await browser.close();
  }
  console.log(`Dashboard screenshots written to ${outputDir} (${seq} total)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
