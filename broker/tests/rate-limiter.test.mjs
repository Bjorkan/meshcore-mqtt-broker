import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { RateLimiter } from '../dist/rate-limiter.js';

const realNow = Date.now;

function setNow(now) {
  Date.now = () => now;
}

afterEach(() => {
  Date.now = realNow;
});

test('allows attempts below the failure threshold', () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 3, 300_000);

  assert.equal(limiter.isBlocked('203.0.113.10'), false);
  assert.equal(limiter.recordFailure('203.0.113.10'), false);
  assert.equal(limiter.recordFailure('203.0.113.10'), false);
  assert.equal(limiter.isBlocked('203.0.113.10'), false);
});

test('blocks at the configured failure threshold', () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 3, 300_000);

  assert.equal(limiter.recordFailure('203.0.113.11'), false);
  assert.equal(limiter.recordFailure('203.0.113.11'), false);
  assert.equal(limiter.recordFailure('203.0.113.11'), true);
  assert.equal(limiter.isBlocked('203.0.113.11'), true);
});

test('remains blocked during the block window', () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 2, 300_000);

  limiter.recordFailure('203.0.113.12');
  limiter.recordFailure('203.0.113.12');

  setNow(200_000);
  assert.equal(limiter.isBlocked('203.0.113.12'), true);
});

test('resets after the failure window expires', () => {
  setNow(1_000);
  const limiter = new RateLimiter(60_000, 2, 300_000);

  assert.equal(limiter.recordFailure('203.0.113.13'), false);

  setNow(70_000);
  assert.equal(limiter.isBlocked('203.0.113.13'), false);
  assert.equal(limiter.recordFailure('203.0.113.13'), false);
  assert.equal(limiter.isBlocked('203.0.113.13'), false);
});
