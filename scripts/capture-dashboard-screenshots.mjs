import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const dashboardUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:8080";
const outputDir =
  process.env.DASHBOARD_SCREENSHOT_DIR || path.resolve("dashboard-screenshots");

async function screenshot(page, name, options = {}) {
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    fullPage: true,
    ...options,
  });
}

async function waitForDashboard(page) {
  await page.goto(dashboardUrl, { waitUntil: "networkidle" });
  await page.locator(".topbar-title", { hasText: "MeshCore MQTT" }).waitFor();
  await page.locator("#clients").waitFor();
}

async function assertViewportIntegrity(page, label) {
  const result = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    const overflow = root.scrollWidth - root.clientWidth;
    const undersizedTargets = Array.from(
      globalThis.document.querySelectorAll(
        'button, [role="button"], .nav-item, input, select',
      ),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.height < 44 || rect.width < 44)
        );
      })
      .map((element) => ({
        element: element.outerHTML.slice(0, 120),
        height: Math.round(element.getBoundingClientRect().height),
        width: Math.round(element.getBoundingClientRect().width),
      }));
    return { overflow, undersizedTargets };
  });

  if (result.overflow > 1) {
    throw new Error(`${label}: ${result.overflow}px horizontal overflow`);
  }
  if (result.undersizedTargets.length > 0) {
    throw new Error(
      `${label}: undersized interaction targets ${JSON.stringify(result.undersizedTargets)}`,
    );
  }
}

async function openView(page, view) {
  await page.locator(`[data-nav="${view}"]`).click();
  await page.waitForURL(new RegExp(`#${view}`));
  await page.waitForTimeout(250);
}

async function assertDialogIntegrity(page, label) {
  const dialog = page.locator('[role="dialog"]');
  const overflow = await dialog.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  if (overflow > 1) {
    throw new Error(`${label}: ${overflow}px horizontal dialog overflow`);
  }
}

async function openFirstClickableRow(page) {
  const row = page.locator("table tbody tr.click-row").first();
  await row.waitFor();
  await row.click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
}

async function openClickableRowByText(page, text) {
  const row = page
    .locator("table tbody tr.click-row", { hasText: text })
    .first();
  await row.waitFor({ state: "visible" });
  await row.click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
}

async function closeModal(page) {
  const closeButton = page.locator(
    '[role="dialog"] button[aria-label="Close"]',
  );
  if ((await closeButton.count()) > 0) {
    await closeButton.first().click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
  }
}

async function assertText(page, text, message) {
  await page
    .getByText(text)
    .first()
    .waitFor({ timeout: 5000, state: "visible" });
  if (message) console.log(`  ✓ ${message}`);
}

async function captureDesktop(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await waitForDashboard(page);
  await assertText(page, "ReviewBroker", "broker data seeded");
  await assertText(page, "Stockholm Rooftop", "observer data seeded");
  await assertViewportIntegrity(page, "desktop overview");
  await screenshot(page, "desktop-01-overview");

  await openView(page, "brokers");
  await screenshot(page, "desktop-02-brokers");
  await openFirstClickableRow(page);
  await screenshot(page, "desktop-03-broker-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "observers");
  await screenshot(page, "desktop-04-observers");
  await openClickableRowByText(page, "Stockholm Rooftop");
  await assertText(
    page,
    "Latest neighbor snapshot",
    "neighbor snapshot visible in observer modal",
  );
  await assertText(page, "Responded", "neighbor query result visible");
  await assertDialogIntegrity(page, "desktop observer modal");
  await screenshot(page, "desktop-05-observer-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "bans");
  await assertText(page, "Invalid IATA code", "Invalid IATA event seeded");
  await screenshot(page, "desktop-06-denied");
  await openFirstClickableRow(page);
  await screenshot(page, "desktop-07-denied-modal", { fullPage: false });
  await closeModal(page);

  const iataRow = page.getByText("Invalid IATA code").first();
  await iataRow.click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
  await assertText(
    page,
    "Change to STO or GOT",
    "Invalid IATA remediation visible",
  );
  await screenshot(page, "desktop-08-denied-iata-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "overview");
  const lookupInput = page.locator(".lookup-input");
  await lookupInput.waitFor();
  await lookupInput.fill(
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  );
  await page.locator(".lookup-button").click();
  await page.waitForSelector(".lookup-result", { timeout: 5000 });
  await page.waitForTimeout(300);
  await screenshot(page, "desktop-09-lookup-result");

  await openView(page, "subscribers");
  await assertText(page, "visual-review", "subscriber data seeded");
  await assertText(page, "ReviewBroker-STO", "STO subscriber broker visible");
  await assertText(page, "meshcore/#", "subscriber topic filters visible");
  await screenshot(page, "desktop-10-subscribers");
  await openFirstClickableRow(page);
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
  await assertText(
    page,
    "Total active connections",
    "subscriber modal shows totals",
  );
  await assertText(
    page,
    "Subscribed topic filters",
    "subscriber modal shows topic filters",
  );
  await screenshot(page, "desktop-11-subscriber-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "brokers");
  const sortHeader = page.locator(".sort-button").first();
  if ((await sortHeader.count()) > 0) {
    await sortHeader.click();
    await page.waitForTimeout(200);
  }
  await screenshot(page, "desktop-12-brokers-sorted");

  await openView(page, "meshcoreio");
  await assertText(page, "Queue coordinator", "MeshCore.io producer visible");
  await assertText(
    page,
    "ReviewBroker-STO",
    "MeshCore.io shared workers seeded",
  );
  await assertText(
    page,
    "Vasastan Rooftop",
    "MeshCore.io upload history seeded",
  );
  await assertText(page, "Advert map", "MeshCore.io map visible");
  await assertText(page, "Uppsala Field Sensor", "mapped advert list seeded");
  await assertViewportIntegrity(page, "desktop MeshCore.io");
  await screenshot(page, "desktop-13-meshcoreio");

  await page.close();
}

async function captureMobile(browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await waitForDashboard(page);
  await assertViewportIntegrity(page, "mobile overview");
  await screenshot(page, "mobile-01-overview");

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await screenshot(page, "mobile-02-open-menu", { fullPage: false });

  await openView(page, "brokers");
  await screenshot(page, "mobile-03-brokers");
  await openFirstClickableRow(page);
  await screenshot(page, "mobile-04-broker-modal", { fullPage: false });
  await closeModal(page);

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "observers");
  await screenshot(page, "mobile-05-observers");
  await openClickableRowByText(page, "Stockholm Rooftop");
  await assertText(page, "Latest neighbor snapshot");
  await assertText(page, "Responded", "mobile neighbor query result visible");
  await assertDialogIntegrity(page, "mobile observer modal");
  await screenshot(page, "mobile-06-observer-modal", { fullPage: false });
  await closeModal(page);

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "bans");
  await screenshot(page, "mobile-07-bans");
  await openFirstClickableRow(page);
  await screenshot(page, "mobile-08-denied-modal", { fullPage: false });
  await closeModal(page);

  const iataRowMobile = page.getByText("Invalid IATA code").first();
  await iataRowMobile.click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
  await screenshot(page, "mobile-09-denied-iata-modal", { fullPage: false });
  await closeModal(page);

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "overview");
  const lookupInput = page.locator(".lookup-input");
  await lookupInput.waitFor();
  await lookupInput.fill(
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  );
  await page.locator(".lookup-button").click();
  await page.waitForSelector(".lookup-result", { timeout: 5000 });
  await page.waitForTimeout(300);
  await screenshot(page, "mobile-10-lookup-result");

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "subscribers");
  await assertText(page, "visual-review", "mobile subscriber data");
  await assertText(page, "meshcore/#", "mobile subscriber topics");
  await screenshot(page, "mobile-11-subscribers");
  const subRow = page.locator("table tbody tr.click-row").first();
  await subRow.click();
  await page.locator('[role="dialog"]').waitFor();
  await page.waitForTimeout(220);
  await screenshot(page, "mobile-12-subscriber-modal", { fullPage: false });
  await closeModal(page);

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "meshcoreio");
  await assertText(
    page,
    "Queue coordinator",
    "mobile MeshCore.io producer visible",
  );
  await assertText(
    page,
    "ReviewBroker-STO",
    "mobile MeshCore.io workers seeded",
  );
  await assertText(page, "Advert map", "mobile MeshCore.io map visible");
  await assertViewportIntegrity(page, "mobile MeshCore.io");
  await screenshot(page, "mobile-13-meshcoreio");

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
    await assertViewportIntegrity(page, viewport.label);
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
    await validateResponsiveWidths(browser);
  } finally {
    await browser.close();
  }
  console.log(`Dashboard screenshots written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
