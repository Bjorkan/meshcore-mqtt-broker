import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createSwedishCountiesLookup, createUnavailableLookup } from '../dist/swedish-counties.js';

// Real structure from https://codeberg.org/meshat/lookup-data/raw/branch/main/meshcore/swedish_counties.json
// Top-level: { metadata: { title, description, ... }, swedish_counties: [{ name, primary_iata, county_code, iata_codes[] }] }
const TEST_COUNTIES_RESPONSE = {
  metadata: {
    title: 'Svenska län med MeshCore-länskoder och IATA-koder',
    description: 'JSON-fil med svenska län, primär IATA-kod enligt Meshat.se',
  },
  swedish_counties: [
    {
      name: 'Stockholms län',
      primary_iata: 'STO',
      county_code: 'se01',
      iata_codes: ['STO', 'ARN', 'BMA'],
    },
    {
      name: 'Skåne län',
      primary_iata: 'MMX',
      county_code: 'se12',
      iata_codes: ['MMX', 'AGH', 'KID'],
    },
    {
      name: 'Västra Götalands län',
      primary_iata: 'GOT',
      county_code: 'se14',
      iata_codes: ['GOT', 'GSE', 'THN'],
    },
  ],
};

// Helper to extract just the swedish_counties array for tests that don't need metadata
const TEST_COUNTIES = TEST_COUNTIES_RESPONSE.swedish_counties;

function mockFetchImpl(responseData, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(responseData); },
  });
}

function mockFetchError() {
  return async () => { throw new Error('Network error'); };
}

function mockFetchText(rawText, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return rawText; },
  });
}

test('parses valid swedish_counties JSON and builds lookup', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('STO'), 'Stockholms län');
  assert.equal(lookup.getCountyForIata('ARN'), 'Stockholms län');
  assert.equal(lookup.getCountyForIata('BMA'), 'Stockholms län');
  assert.equal(lookup.getCountyForIata('MMX'), 'Skåne län');
  assert.equal(lookup.getCountyForIata('AGH'), 'Skåne län');
  assert.equal(lookup.getCountyForIata('GOT'), 'Västra Götalands län');
  assert.equal(lookup.getCountyForIata('XXX'), undefined);
});

test('getPrimaryIataForIata returns primary IATA for any IATA in the county', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.getPrimaryIataForIata('STO'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('ARN'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('BMA'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('MMX'), 'MMX');
  assert.equal(lookup.getPrimaryIataForIata('AGH'), 'MMX');
  assert.equal(lookup.getPrimaryIataForIata('GOT'), 'GOT');
  assert.equal(lookup.getPrimaryIataForIata('XXX'), undefined);
});

test('isPrimaryIata returns true only for primary IATA codes', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.isPrimaryIata('STO'), true);
  assert.equal(lookup.isPrimaryIata('ARN'), false);
  assert.equal(lookup.isPrimaryIata('BMA'), false);
  assert.equal(lookup.isPrimaryIata('MMX'), true);
  assert.equal(lookup.isPrimaryIata('AGH'), false);
  assert.equal(lookup.isPrimaryIata('GOT'), true);
  assert.equal(lookup.isPrimaryIata('GSE'), false);
  assert.equal(lookup.isPrimaryIata('XXX'), false);
});

test('getCorrectionForIata returns undefined for primary IATA codes', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.getCorrectionForIata('STO'), undefined);
  assert.equal(lookup.getCorrectionForIata('MMX'), undefined);
  assert.equal(lookup.getCorrectionForIata('GOT'), undefined);
});

test('getCorrectionForIata returns correction for secondary IATA codes', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.getCorrectionForIata('AGH'), 'Tills observer byter till korrekt IATA MMX för Skåne län');
  assert.equal(lookup.getCorrectionForIata('ARN'), 'Tills observer byter till korrekt IATA STO för Stockholms län');
  assert.equal(lookup.getCorrectionForIata('GSE'), 'Tills observer byter till korrekt IATA GOT för Västra Götalands län');
});

test('getCorrectionForIata returns undefined for unknown IATA codes', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  assert.equal(lookup.getCorrectionForIata('XXX'), undefined);
  assert.equal(lookup.getCorrectionForIata('CPH'), undefined);
});

test('getAllCountyLookup returns structured data for all IATA codes', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: TEST_COUNTIES }) });

  const info = lookup.getAllCountyLookup();
  assert.equal(info['STO'].countyName, 'Stockholms län');
  assert.equal(info['STO'].isPrimary, true);
  assert.equal(info['STO'].primaryIata, 'STO');
  assert.equal(info['ARN'].countyName, 'Stockholms län');
  assert.equal(info['ARN'].isPrimary, false);
  assert.equal(info['ARN'].primaryIata, 'STO');
  assert.equal(info['AGH'].countyName, 'Skåne län');
  assert.equal(info['AGH'].isPrimary, false);
  assert.equal(info['AGH'].primaryIata, 'MMX');
  assert.equal(info['GOT'].countyName, 'Västra Götalands län');
  assert.equal(info['GOT'].isPrimary, true);
  assert.equal(info['XXX'], undefined);
});

test('normalizes IATA codes with trim and uppercase', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        swedish_counties: [
          { name: 'Test Län', primary_iata: ' tst ', county_code: 'se99', iata_codes: [' tst ', ' abc ', ' XYZ '] },
        ],
      });
    },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('TST'), 'Test Län');
  assert.equal(lookup.getCountyForIata('abc'), 'Test Län');
  assert.equal(lookup.getCountyForIata('xyz'), 'Test Län');
  assert.equal(lookup.isPrimaryIata('TST'), true);
  assert.equal(lookup.isPrimaryIata('abc'), false);
  assert.equal(lookup.getPrimaryIataForIata('xyz'), 'TST');
});

test('returns fallback when HTTP fetch fails', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchError() });

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
  assert.equal(lookup.getPrimaryIataForIata('STO'), undefined);
});

test('returns fallback when HTTP status is not OK', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ error: 'Not found' }, 404) });

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
});

test('returns fallback when JSON is missing swedish_counties array', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ metadata: {} }) });

  assert.equal(lookup.isAvailable(), false);
});

test('returns fallback when JSON is empty object', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({}) });

  assert.equal(lookup.isAvailable(), false);
});

test('getAllCountyLookup is empty when lookup is unavailable', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchError() });

  assert.deepEqual(lookup.getAllCountyLookup(), {});
});

test('isAvailable returns false when no valid counties loaded', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ swedish_counties: [] }) });

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
});

test('validates county entries and skips invalid ones', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        swedish_counties: [
          { name: 'Valid', primary_iata: 'ABC', county_code: 'se01', iata_codes: ['ABC'] },
          { name: '', primary_iata: 'DEF', county_code: 'se02', iata_codes: ['DEF'] },
          { name: 'NoPrimary', primary_iata: '', county_code: 'se03', iata_codes: ['GHI'] },
          { name: 'BadPrimary', primary_iata: 'INVALID', county_code: 'se04', iata_codes: ['INVALID'] },
          { name: 'NoArray', primary_iata: 'JKL', county_code: 'se05' },
          { name: 'PrimaryMissing', primary_iata: 'MNO', county_code: 'se06', iata_codes: ['PQR'] },
          { name: 'Null', primary_iata: null, county_code: 'se07', iata_codes: ['STU'] },
          { name: 'LongName', primary_iata: 'ZZZ', county_code: 'se08', iata_codes: ['ZZZ'], extra: 'should be ignored' },
          { name: 'InvalidIataChar', primary_iata: '123', county_code: 'se09', iata_codes: ['123'] },
          { name: 'MixedCaseIata', primary_iata: 'xxx', county_code: 'se10', iata_codes: ['xxx', 'YYY'] },
        ],
      });
    },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('ABC'), 'Valid');
  assert.equal(lookup.getCountyForIata('DEF'), undefined);
  assert.equal(lookup.getCountyForIata('GHI'), undefined);
  assert.equal(lookup.getCountyForIata('JKL'), undefined);
  assert.equal(lookup.getCountyForIata('PQR'), undefined);
  assert.equal(lookup.getCountyForIata('MNO'), undefined);
  assert.equal(lookup.getCountyForIata('123'), undefined);
  assert.equal(lookup.getCountyForIata('XXX'), 'MixedCaseIata'); // normalized from 'xxx'
  assert.equal(lookup.getCountyForIata('YYY'), 'MixedCaseIata');
});

test('lookup is unavailable when all entries are invalid', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        swedish_counties: [
          { name: '', primary_iata: 'ABC', county_code: 'se01', iata_codes: ['ABC'] },
          { name: 'Bad', primary_iata: null, county_code: 'se02', iata_codes: ['DEF'] },
        ],
      });
    },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('injected fetchImpl is used instead of global fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ swedish_counties: [{ name: 'Test', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] });
      },
    };
  };
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(called, true);
  assert.equal(lookup.isAvailable(), true);
});

test('timeout aborts fetch via AbortController', async () => {
  const fetchImpl = async (_url, options) => {
    await new Promise((resolve, reject) => {
      if (options?.signal) {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }
    });
  };

  const lookup = await createSwedishCountiesLookup({ fetchImpl, timeoutMs: 1 });
  assert.equal(lookup.isAvailable(), false);
});

test('invalid JSON in response body makes lookup unavailable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return 'not valid json'; },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('Content-Length over max makes lookup unavailable without reading body', async () => {
  let bodyRead = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-length', '300000']]),
    get contentLength() { return 300000; },
    async text() { bodyRead = true; return '{}'; },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
  assert.equal(bodyRead, false);
});

test('stream response with body over limit makes lookup unavailable', async () => {
  const largeChunk = 'x'.repeat(200 * 1024);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let returned = false;
        return {
          read() {
            if (returned) return Promise.resolve({ done: true, value: undefined });
            returned = true;
            return Promise.resolve({ done: false, value: Buffer.from(largeChunk + largeChunk) });
          },
          cancel() {},
        };
      },
    },
    async text() { return largeChunk + largeChunk; },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });
  assert.equal(lookup.isAvailable(), false);
});

test('stream response with body under limit works', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let returned = false;
        return {
          read() {
            if (returned) return Promise.resolve({ done: true, value: undefined });
            returned = true;
            return Promise.resolve({ done: false, value: Buffer.from(JSON.stringify({ swedish_counties: [TEST_COUNTIES[0]] })) });
          },
          cancel() {},
        };
      },
    },
    async text() { return JSON.stringify({ swedish_counties: [TEST_COUNTIES[0]] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });
  assert.equal(lookup.isAvailable(), true);
});

test('response too large makes lookup unavailable', async () => {
  const largeText = '{"x":' + ' '.repeat(260 * 1024) + ' "y": 1}';
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return largeText; },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('HTTP 500 makes lookup unavailable', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchImpl({ error: 'Server error' }, 500) });

  assert.equal(lookup.isAvailable(), false);
});

test('fetch throws directly makes lookup unavailable', async () => {
  const lookup = await createSwedishCountiesLookup({ fetchImpl: mockFetchError() });

  assert.equal(lookup.isAvailable(), false);
});

test('createUnavailableLookup returns lookup with isAvailable false', async () => {
  const { createUnavailableLookup } = await import('../dist/swedish-counties.js');
  const lookup = createUnavailableLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
  assert.equal(lookup.getPrimaryIataForIata('STO'), undefined);
  assert.equal(lookup.isPrimaryIata('STO'), false);
  assert.deepEqual(lookup.getAllCountyLookup(), {});
});

test('rejects county name with null character', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'Bad\x00Name', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('rejects county name with tab character', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'Bad\tName', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('rejects county name with newline character', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'Bad\nName', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('rejects county name with carriage return', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'Bad\rName', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('trims county name from whitespace', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: '  Test Län  ', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('AAA'), 'Test Län');
});

test('IATA conflict between two counties makes lookup unavailable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'County A', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA', 'BBB'] }, { name: 'County B', primary_iata: 'CCC', county_code: 'se02', iata_codes: ['BBB', 'CCC'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), false);
});

test('same IATA in same county handles deduplication fine', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ swedish_counties: [{ name: 'Same County', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA', 'AAA'] }] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('AAA'), 'Same County');
});

test('accepts full real schema with metadata top-level field', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify(TEST_COUNTIES_RESPONSE); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('STO'), 'Stockholms län');
  assert.equal(lookup.getCountyForIata('AGH'), 'Skåne län');
});

test('extra top-level fields are ignored', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ version: '1', swedish_counties: [TEST_COUNTIES[0]] }); },
  });
  const lookup = await createSwedishCountiesLookup({ fetchImpl });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('STO'), 'Stockholms län');
});

test('logs count of invalid entries in mixed data', async () => {
  const warnMsgs = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnMsgs.push(args.join(' ')); };
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({
        swedish_counties: [
          { name: 'Valid', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] },
          { name: '', primary_iata: 'BBB', county_code: 'se02', iata_codes: ['BBB'] },
          { name: 'AlsoValid', primary_iata: 'CCC', county_code: 'se03', iata_codes: ['CCC'] },
        ],
      }); },
    });
    const lookup = await createSwedishCountiesLookup({ fetchImpl });
    assert.equal(lookup.isAvailable(), true);
    assert.equal(lookup.getCountyForIata('AAA'), 'Valid');
    assert.equal(lookup.getCountyForIata('CCC'), 'AlsoValid');
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warnMsgs.some(msg => msg.includes('1 av 3') && msg.includes('ogiltiga')), JSON.stringify(warnMsgs));
});

test('logs warning when all entries are invalid', async () => {
  const warnMsgs = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnMsgs.push(args.join(' ')); };
  try {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({
        swedish_counties: [
          { name: '', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] },
          { name: null, primary_iata: 'BBB', county_code: 'se02', iata_codes: ['BBB'] },
        ],
      }); },
    });
    const lookup = await createSwedishCountiesLookup({ fetchImpl });
    assert.equal(lookup.isAvailable(), false);
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warnMsgs.some(msg => msg.includes('2 av 2') && msg.includes('ogiltiga')), JSON.stringify(warnMsgs));
});
