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
  await page.locator("h1", { hasText: "MeshCore MQTT Brokers" }).waitFor();
  await page.locator("#clients").waitFor();
}

async function openView(page, view) {
  await page.locator(`[data-nav="${view}"]`).click();
  await page.waitForURL(new RegExp(`#${view}`));
  await page.waitForTimeout(250);
}

async function openFirstClickableRow(page) {
  const row = page.locator("table tbody tr.click-row").first();
  await row.waitFor();
  await row.click();
  await page.locator('[role="dialog"]').waitFor();
}

async function closeModal(page) {
  const closeButton = page.locator(
    '[role="dialog"] button[aria-label="Stäng"]',
  );
  if ((await closeButton.count()) > 0) {
    await closeButton.first().click();
    await page.locator('[role="dialog"]').waitFor({ state: "detached" });
  }
}

async function captureDesktop(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await waitForDashboard(page);
  await screenshot(page, "desktop-01-overview");

  await openView(page, "brokers");
  await screenshot(page, "desktop-02-brokers");
  await openFirstClickableRow(page);
  await screenshot(page, "desktop-03-broker-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "observers");
  await screenshot(page, "desktop-04-observers");
  await openFirstClickableRow(page);
  await screenshot(page, "desktop-05-observer-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "bans");
  await screenshot(page, "desktop-06-denied");
  await openFirstClickableRow(page);
  await screenshot(page, "desktop-07-denied-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "overview");
  const lookupInput = page.locator(".lookup-input");
  if ((await lookupInput.count()) > 0) {
    await lookupInput.fill(
      "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    );
    await page.locator(".lookup-button").click();
    await page
      .waitForSelector(".lookup-result", { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, "desktop-08-lookup-result");
  }

  await openView(page, "subscribers");
  await page.getByText("visual-review").waitFor({ timeout: 5000 });
  await screenshot(page, "desktop-09-subscribers");
  await openFirstClickableRow(page);
  await page.locator('[role="dialog"]').waitFor();
  await screenshot(page, "desktop-10-subscriber-modal", { fullPage: false });
  await closeModal(page);

  await openView(page, "bans");
  const iataRows = page.getByText("Fel IATA-kod");
  if ((await iataRows.count()) > 0) {
    await iataRows.first().click();
    await page.locator('[role="dialog"]').waitFor();
    await screenshot(page, "desktop-11-denied-iata-modal", { fullPage: false });
    await closeModal(page);
  }

  await page.close();
}

async function captureMobile(browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await waitForDashboard(page);
  await screenshot(page, "mobile-01-overview");

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await screenshot(page, "mobile-02-open-menu");

  await openView(page, "observers");
  await screenshot(page, "mobile-03-observers");
  await openFirstClickableRow(page);
  await screenshot(page, "mobile-04-observer-modal", { fullPage: false });
  await closeModal(page);

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "bans");
  await screenshot(page, "mobile-05-bans");
  const banRow = page.locator("table tbody tr.click-row").first();
  if ((await banRow.count()) > 0) {
    await banRow.click();
    await page.locator('[role="dialog"]').waitFor();
    await screenshot(page, "mobile-06-denied-modal", { fullPage: false });
    await closeModal(page);
  }

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "overview");
  const lookupInput = page.locator(".lookup-input");
  if ((await lookupInput.count()) > 0) {
    await lookupInput.fill(
      "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    );
    await page.locator(".lookup-button").click();
    await page
      .waitForSelector(".lookup-result", { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    await screenshot(page, "mobile-07-lookup-result");
  }

  await page.locator(".menu-button").click();
  await page.waitForTimeout(200);
  await openView(page, "subscribers");
  await page.getByText("visual-review").waitFor({ timeout: 5000 });
  await screenshot(page, "mobile-08-subscribers");
  const subRow = page.locator("table tbody tr.click-row").first();
  if ((await subRow.count()) > 0) {
    await subRow.click();
    await page.locator('[role="dialog"]').waitFor();
    await screenshot(page, "mobile-09-subscriber-modal", { fullPage: false });
    await closeModal(page);
  }

  await page.close();
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    await captureDesktop(browser);
    await captureMobile(browser);
  } finally {
    await browser.close();
  }
  console.log(`Dashboard screenshots written to ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
