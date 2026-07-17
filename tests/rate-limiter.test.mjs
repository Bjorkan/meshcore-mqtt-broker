import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";

import { RateLimiter } from "../dist/rate-limiter.js";

function setNow(now) {
  jest.useFakeTimers().setSystemTime(now);
}

afterEach(() => {
  jest.useRealTimers();
});

test("allows attempts below the failure threshold", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 3, 300_000);

  assert.equal(limiter.isBlocked("203.0.113.10"), false);
  assert.equal(limiter.recordFailure("203.0.113.10"), false);
  assert.equal(limiter.recordFailure("203.0.113.10"), false);
  assert.equal(limiter.isBlocked("203.0.113.10"), false);
});

test("blocks on the first failure when the threshold is one", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 1, 300_000);

  assert.equal(limiter.recordFailure("203.0.113.9"), true);
  assert.equal(limiter.isBlocked("203.0.113.9"), true);
});

test("blocks at the configured failure threshold", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 3, 300_000);

  assert.equal(limiter.recordFailure("203.0.113.11"), false);
  assert.equal(limiter.recordFailure("203.0.113.11"), false);
  assert.equal(limiter.recordFailure("203.0.113.11"), true);
  assert.equal(limiter.isBlocked("203.0.113.11"), true);
});

test("remains blocked during the block window", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 2, 300_000);

  limiter.recordFailure("203.0.113.12");
  limiter.recordFailure("203.0.113.12");

  setNow(200_000);
  assert.equal(limiter.isBlocked("203.0.113.12"), true);
});

test("resets after the failure window expires", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 2, 300_000);

  assert.equal(limiter.recordFailure("203.0.113.13"), false);

  setNow(70_000);
  assert.equal(limiter.isBlocked("203.0.113.13"), false);
  assert.equal(limiter.recordFailure("203.0.113.13"), false);
  assert.equal(limiter.isBlocked("203.0.113.13"), false);
});

test("resets immediately after a shorter block expires", () => {
  setNow(1_000);
  const limiter = new RateLimiter(300_000, 2, 10_000);

  limiter.recordFailure("203.0.113.14");
  limiter.recordFailure("203.0.113.14");
  assert.equal(limiter.isBlocked("203.0.113.14"), true);

  setNow(12_000);
  assert.equal(limiter.isBlocked("203.0.113.14"), false);
  assert.equal(limiter.recordFailure("203.0.113.14"), false);
  assert.equal(limiter.isBlocked("203.0.113.14"), false);
});

test("bounds tracked IP state under unique-address floods", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 2, 300_000, 2);

  limiter.recordFailure("203.0.113.20");
  limiter.recordFailure("203.0.113.21");
  limiter.recordFailure("203.0.113.22");

  assert.equal(
    limiter.recordFailure("203.0.113.20"),
    false,
    "the oldest tracked address should have been evicted",
  );
});

test("successful authentication clears accumulated failures", () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 3, 300_000);

  assert.equal(limiter.recordFailure("203.0.113.30"), false);
  assert.equal(limiter.recordFailure("203.0.113.30"), false);

  limiter.recordSuccess("203.0.113.30");

  assert.equal(limiter.recordFailure("203.0.113.30"), false);
  assert.equal(limiter.isBlocked("203.0.113.30"), false);
});
