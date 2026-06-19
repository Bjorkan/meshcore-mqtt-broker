import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getClientIP } from '../dist/ip-utils.js';

function request(headers = {}, remoteAddress) {
  return {
    headers,
    socket: { remoteAddress },
  };
}

function withProxyEnv(env, fn) {
  const previousTrustProxy = process.env.TRUST_PROXY;
  const previousTrustedProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;

  if ('TRUST_PROXY' in env) {
    process.env.TRUST_PROXY = env.TRUST_PROXY;
  } else {
    delete process.env.TRUST_PROXY;
  }

  if ('TRUSTED_PROXY_CIDRS' in env) {
    process.env.TRUSTED_PROXY_CIDRS = env.TRUSTED_PROXY_CIDRS;
  } else {
    delete process.env.TRUSTED_PROXY_CIDRS;
  }

  try {
    fn();
  } finally {
    if (previousTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = previousTrustProxy;
    }

    if (previousTrustedProxyCidrs === undefined) {
      delete process.env.TRUSTED_PROXY_CIDRS;
    } else {
      process.env.TRUSTED_PROXY_CIDRS = previousTrustedProxyCidrs;
    }
  }
}

test('ignores spoofed proxy headers for direct clients by default', () => {
  withProxyEnv({}, () => {
    assert.equal(
      getClientIP(request({
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.10',
      }, '198.51.100.1')),
      '198.51.100.1',
    );
  });
});

test('prefers Cloudflare connecting IP from a trusted proxy', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.10',
      }, '198.51.100.1')),
      '203.0.113.10',
    );
  });
});

test('uses loopback as the default trusted proxy CIDR when trust proxy is enabled', () => {
  withProxyEnv({ TRUST_PROXY: 'true' }, () => {
    assert.equal(
      getClientIP(request({ 'cf-connecting-ip': '203.0.113.15' }, '127.0.0.1')),
      '203.0.113.15',
    );
  });
});

test('does not trust headers from an untrusted proxy address', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({ 'cf-connecting-ip': '203.0.113.10' }, '192.0.2.1')),
      '192.0.2.1',
    );
  });
});

test('handles array headers from a trusted proxy', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({ 'cf-connecting-ip': ['203.0.113.20', '203.0.113.21'] }, '198.51.100.1')),
      '203.0.113.20',
    );
  });
});

test('uses the first forwarded IP from a trusted proxy', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({ 'x-forwarded-for': '203.0.113.30, 198.51.100.30' }, '198.51.100.1')),
      '203.0.113.30',
    );
  });
});

test('falls back to X-Real-IP from a trusted proxy', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({ 'x-real-ip': '203.0.113.40' }, '198.51.100.1')),
      '203.0.113.40',
    );
  });
});

test('falls back to socket remote address when trusted proxy header is invalid', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '198.51.100.0/24' }, () => {
    assert.equal(
      getClientIP(request({ 'cf-connecting-ip': 'not-an-ip' }, '198.51.100.1')),
      '198.51.100.1',
    );
  });
});

test('supports IPv6 trusted proxy CIDRs', () => {
  withProxyEnv({ TRUST_PROXY: 'true', TRUSTED_PROXY_CIDRS: '2001:db8::/32' }, () => {
    assert.equal(
      getClientIP(request({ 'x-forwarded-for': '2001:db8:1::10' }, '2001:db8::1')),
      '2001:db8:1::10',
    );
  });
});

test('normalizes IPv4-mapped IPv6 socket addresses', () => {
  withProxyEnv({}, () => {
    assert.equal(getClientIP(request({}, '::ffff:203.0.113.50')), '203.0.113.50');
  });
});

test('falls back to socket remote address', () => {
  assert.equal(
    getClientIP(request({}, '203.0.113.50')),
    '203.0.113.50',
  );
});

test('returns unknown when no address is available', () => {
  assert.equal(getClientIP(request({}, undefined)), 'unknown');
});
