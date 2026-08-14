import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "../dist/database.js";
import { createApiHandler } from "../dist/api.js";
import { createDashboardHandler, DashboardState } from "../dist/dashboard.js";
import { BrokerStateStore } from "../dist/state-store.js";
import { createWebServer } from "../dist/web-server.js";

const outputDirectory = path.resolve(
  process.env.DASHBOARD_SCREENSHOT_DIR || "dashboard-screenshots",
);
const host = "127.0.0.1";
const port = Number.parseInt(
  process.env.DASHBOARD_SCREENSHOT_PORT || "4174",
  10,
);
const baseUrl = `http://${host}:${port}`;
const instanceId = "Broker-REVIEW";
const themeStorageKey = "meshcore-dashboard-theme";
const now = Date.now();
const hour = 60 * 60 * 1_000;
const keys = ["A", "B", "C", "D", "E"].map((value) => value.repeat(64));
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const counties = {
  STO: { countyName: "Stockholm", primaryIata: "STO", isPrimary: true },
  ARN: { countyName: "Stockholm", primaryIata: "STO", isPrimary: false },
  BMA: { countyName: "Stockholm", primaryIata: "STO", isPrimary: false },
  NYO: { countyName: "Sodermanland", primaryIata: "NYO", isPrimary: true },
  VST: { countyName: "Vastmanland", primaryIata: "VST", isPrimary: true },
};

function observerEntry(index, name, region, messageCount, neighbors) {
  const publicKey = keys[index];
  const lastConnectedAt = now - (index + 1) * 12 * 60 * 1_000;
  const messages = Array.from(
    { length: Math.min(messageCount, 8) },
    (_, messageIndex) => {
      const subtopic = messageIndex % 2 === 0 ? "status" : "packets";
      return {
        topic: `meshcore/${region}/${publicKey}/${subtopic}`,
        broker: instanceId,
        region,
        observer: name,
        publicKey,
        subtopic,
        bytes: 96 + messageIndex * 13,
        receivedAt: now - messageIndex * 72_000 - index * 9_000,
      };
    },
  );
  return {
    label: name,
    publicKey,
    broker: instanceId,
    region,
    active: false,
    lastConnectedAt,
    lastSeenAt: messages[0].receivedAt,
    messageCount,
    messages,
    neighbors,
  };
}

function meshcoreIoSnapshot() {
  return {
    enabled: true,
    processor: { instanceId, status: "healthy" },
    queue: {
      ingressPending: 2,
      queued: 7,
      claimed: 1,
      active: 1,
      claimedNotActive: 0,
      total: 10,
      maxQueuedUploads: 250,
    },
    totals: {
      enqueued: 428,
      uploaded: 397,
      dropped: 11,
      invalid: 4,
      retries: 19,
    },
    workers: [
      {
        instanceId,
        configuredWorkers: 2,
        activeUploads: 1,
        uploadsSucceeded: 397,
        uploadsFailed: 7,
        lastUploadAt: now - 95_000,
        updatedAt: now - 8_000,
      },
    ],
    history: [
      {
        at: now - 95_000,
        status: "uploaded",
        requestId: "review-upload-1",
        nodeName: "Stockholm Central",
        nodePublicKey: keys[0],
        advertType: "REPEATER",
        observerName: "Stockholm Central",
        workerInstanceId: instanceId,
      },
      {
        at: now - 8 * 60_000,
        status: "dropped",
        requestId: "review-upload-2",
        nodeName: "Bromma Relay",
        nodePublicKey: keys[2],
        advertType: "ROOM",
        observerName: "Bromma Relay",
        workerInstanceId: instanceId,
        detail: "Review fixture: retry limit reached",
      },
    ],
    map: {
      advertsLast7Days: [
        {
          at: now - 95_000,
          requestId: "review-map-1",
          nodeName: "Stockholm Central",
          nodePublicKey: keys[0],
          advertType: "REPEATER",
          observerName: "Stockholm Central",
          workerInstanceId: instanceId,
          latitude: 59.3293,
          longitude: 18.0686,
        },
        {
          at: now - 12 * 60_000,
          requestId: "review-map-2",
          nodeName: "Skavsta Field",
          nodePublicKey: keys[3],
          advertType: "SENSOR",
          observerName: "Skavsta Field",
          workerInstanceId: instanceId,
          latitude: 58.7886,
          longitude: 16.9122,
        },
      ],
    },
  };
}

async function seedSubscriber(stateStore, state, username, clientId, topics) {
  const registration = await stateStore.tryRegisterSubscriberConnection(
    username,
    clientId,
    5,
  );
  if (!registration.allowed) {
    throw new Error(`Could not seed subscriber ${username}/${clientId}`);
  }
  stateStore.activateSubscriberConnection(
    username,
    clientId,
    registration.connectionId,
  );
  await stateStore.updateSubscriberSubscriptions(
    username,
    clientId,
    registration.connectionId,
    topics,
    "add",
  );
  state.recordClientConnected({
    id: clientId,
    clientType: "subscriber",
    username,
  });
}

async function seedDashboard(stateStore, state) {
  const neighbors = {
    receivedAt: now - 4 * 60_000,
    reportedAt: now - 5 * 60_000,
    selfScopes: ["public", "regional"],
    invalidEntryCount: 1,
    neighbors: [
      {
        publicKey: keys[1],
        snr: 8.4,
        heardSecsAgo: 43,
        scopes: ["public"],
        status: "responded",
      },
      {
        publicKey: keys[2],
        snr: 3.1,
        heardSecsAgo: 185,
        scopes: ["regional"],
        status: "timeout",
      },
    ],
  };
  const entries = [
    observerEntry(0, "Stockholm Central", "STO", 1284, neighbors),
    observerEntry(1, "Arlanda North", "ARN", 873),
    observerEntry(2, "Bromma Relay", "BMA", 541),
    observerEntry(3, "Skavsta Field", "NYO", 312),
    observerEntry(4, "Vasteras Sensor", "VST", 198),
  ];
  state.hydrateObserverEntries(entries);
  for (const [index, entry] of entries.entries()) {
    const client = {
      id: `review-observer-${index + 1}`,
      clientType: "publisher",
      publicKey: entry.publicKey,
      nodeName: entry.label,
      lastRegion: entry.region,
      connectedAt: entry.lastConnectedAt,
    };
    state.recordClientConnected(client);
    state.recordClientAuthenticated(client);
    await stateStore.setObserverNodeName(
      entry.publicKey,
      entry.label,
      24 * hour,
    );
  }

  await stateStore.setTrustState(
    keys[2],
    JSON.stringify({
      status: "muted",
      username: "Bromma Relay",
      muteReason: "rate_limit_exceeded",
      abuseBlockCount: 4,
      mutedUntil: now + 3 * hour,
    }),
  );
  await stateStore.recordDeniedPublish({
    node: keys[4],
    label: "Vasteras Sensor",
    reason: "Region is not accepted by this broker",
    topic: `meshcore/TEST/${keys[4]}/status`,
    region: "TEST",
    deniedUntilText: "Until the observer uses an accepted region",
  });
  await stateStore.recordObserverRejection(
    keys[1],
    "authentication",
    "wrong_audience",
  );

  await seedSubscriber(stateStore, state, "public-monitor", "dashboard-east", [
    "meshcore/+/+/status",
    "meshcore/+/+/packets",
  ]);
  await seedSubscriber(stateStore, state, "public-monitor", "dashboard-west", [
    "meshcore/STO/+/status",
  ]);
  await seedSubscriber(stateStore, state, "regional-feed", "feed-client", [
    "meshcore/STO/#",
    "meshcore/NYO/#",
  ]);
}

async function waitForDashboard(page) {
  await page.locator(".topbar-title").waitFor();
  await page.waitForFunction(() => {
    const timestamp = globalThis.document.querySelector(
      ".snapshot-time strong",
    );
    return timestamp?.textContent?.trim() !== "-";
  });
}

async function setTheme(page, theme) {
  await page.evaluate(
    ([key, value]) => globalThis.localStorage.setItem(key, value),
    [themeStorageKey, theme],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDashboard(page);
}

async function capture(page, files, name, fullPage = true) {
  const file = `${name}.png`;
  await page.screenshot({
    path: path.join(outputDirectory, file),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
  files.push(file);
  process.stdout.write(`Captured ${file}\n`);
}

async function openRoute(page, route, expectedHeading) {
  await page.goto(`${baseUrl}/?capture=${Date.now()}${route}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForDashboard(page);
  if (expectedHeading) {
    await page
      .getByRole("heading", { level: 1, name: expectedHeading, exact: true })
      .waitFor();
  }
}

async function captureDesktop(page, files) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRoute(page, "#overview", "Overview");
  await setTheme(page, "light");
  await capture(page, files, "desktop-01-overview-light");

  await setTheme(page, "dark");
  await capture(page, files, "desktop-02-overview-dark");
  await setTheme(page, "light");

  await page.getByRole("textbox", { name: "Name or public key" }).fill("st");
  await page.getByRole("region", { name: "Observer search results" }).waitFor();
  await capture(page, files, "desktop-03-observer-search", false);

  await openRoute(page, "#observers", "Observers");
  await capture(page, files, "desktop-04-observers");
  await page.getByRole("button", { name: /Stockholm Central Online/ }).click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "desktop-05-observer-dialog", false);

  await openRoute(page, "#bans", "Protection");
  await capture(page, files, "desktop-06-protection");
  await page
    .getByRole("button", { name: /Protection event for Vasteras Sensor/ })
    .click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "desktop-07-protection-dialog", false);

  await openRoute(page, "#subscribers", "Subscribers");
  await capture(page, files, "desktop-08-subscribers");
  await page.getByRole("button", { name: "Subscriber public-monitor" }).click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "desktop-09-subscriber-dialog", false);

  await openRoute(page, "#meshcoreio", "MeshCore.io");
  await page.getByText("Advert map", { exact: true }).waitFor();
  await capture(page, files, "desktop-10-meshcoreio");
}

async function captureMobile(page, files) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, "#overview", "Overview");
  await setTheme(page, "light");
  await capture(page, files, "mobile-01-overview");

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator(".navigation-drawer.open").waitFor();
  await page.waitForTimeout(250);
  await capture(page, files, "mobile-02-navigation", false);
  await page
    .getByRole("complementary", { name: "Dashboard navigation" })
    .getByRole("button", { name: "Close menu" })
    .click();

  await page.getByRole("textbox", { name: "Name or public key" }).fill("st");
  await page.getByRole("region", { name: "Observer search results" }).waitFor();
  await capture(page, files, "mobile-03-observer-search", false);

  await openRoute(page, "#observers", "Observers");
  await page.getByRole("button", { name: /Stockholm Central Online/ }).click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "mobile-04-observer-dialog", false);

  await openRoute(page, "#bans", "Protection");
  await page
    .getByRole("button", { name: /Protection event for Vasteras Sensor/ })
    .click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "mobile-05-protection-dialog", false);

  await openRoute(page, "#subscribers", "Subscribers");
  await page.getByRole("button", { name: "Subscriber public-monitor" }).click();
  await page.getByRole("dialog").waitFor();
  await capture(page, files, "mobile-06-subscriber-dialog", false);

  await openRoute(page, "#meshcoreio", "MeshCore.io");
  await page.getByText("Advert map", { exact: true }).waitFor();
  await capture(page, files, "mobile-07-meshcoreio");
}

let database;
let dashboard;
let browser;
let temporaryDirectory;

try {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "meshcore-dashboard-screenshots-"),
  );
  database = await openTestDatabase(path.join(temporaryDirectory, "broker.db"));
  const stateStore = new BrokerStateStore(database, instanceId);
  await stateStore.ready();
  const state = new DashboardState({
    instanceId,
    swedishCountiesLookup: {
      getAllCountyLookup: () => counties,
      isAvailable: () => true,
    },
    meshcoreIoStatus: async () => meshcoreIoSnapshot(),
  });
  await seedDashboard(stateStore, state);

  dashboard = createWebServer({
    host,
    port,
    handlers: [
      createApiHandler({
        stateStore,
        getDashboardSnapshot: () => state.getSnapshot(stateStore, 1),
      }),
      createDashboardHandler({ instanceId }),
    ],
  });
  await dashboard.listen();

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await context.route("**://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ body: transparentPng, contentType: "image/png" }),
  );
  await context.route("**://basemaps.cartocdn.com/**", (route) =>
    route.fulfill({ body: transparentPng, contentType: "image/png" }),
  );
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      process.stderr.write(`Browser console: ${message.text()}\n`);
    }
  });
  const files = [];
  await captureDesktop(page, files);
  await captureMobile(page, files);
  await writeFile(
    path.join(outputDirectory, "files.txt"),
    `${files.join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(
    `Captured ${files.length} dashboard screenshots in ${outputDirectory}\n`,
  );
} finally {
  await browser?.close().catch(() => undefined);
  await dashboard?.close().catch(() => undefined);
  await database?.close().catch(() => undefined);
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
