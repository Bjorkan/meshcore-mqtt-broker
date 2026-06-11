import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getClientIP } from '../dist/ip-utils.js';

function request(headers = {}, remoteAddress) {
  return {
    headers,
    socket: { remoteAddress },
  };
}

test('prefers Cloudflare connecting IP', () => {
  assert.equal(
    getClientIP(request({
      'cf-connecting-ip': '203.0.113.10',
      'x-forwarded-for': '198.51.100.10',
    })),
    '203.0.113.10',
  );
});

test('handles array headers', () => {
  assert.equal(
    getClientIP(request({ 'cf-connecting-ip': ['203.0.113.20', '203.0.113.21'] })),
    '203.0.113.20',
  );
});

test('uses the first forwarded IP', () => {
  assert.equal(
    getClientIP(request({ 'x-forwarded-for': '203.0.113.30, 198.51.100.30' })),
    '203.0.113.30',
  );
});

test('falls back to X-Real-IP', () => {
  assert.equal(
    getClientIP(request({ 'x-real-ip': '203.0.113.40' })),
    '203.0.113.40',
  );
});

test('falls back to socket remote address', () => {
  assert.equal(getClientIP(request({}, '203.0.113.50')), '203.0.113.50');
});

test('returns unknown when no address is available', () => {
  assert.equal(getClientIP(request({}, undefined)), 'unknown');
});
