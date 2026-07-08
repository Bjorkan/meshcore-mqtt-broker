import assert from 'node:assert/strict';
import { test, afterEach, beforeEach } from '@jest/globals';
import { createSwedishCountiesLookup } from '../dist/swedish-counties.js';

const TEST_COUNTIES = [
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
];

const fetchBackup = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = undefined;
});

afterEach(() => {
  globalThis.fetch = fetchBackup;
});

function mockFetch(responseData, status = 200) {
  globalThis.fetch = async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return responseData;
      },
    };
  };
}

function mockFetchError() {
  globalThis.fetch = async () => {
    throw new Error('Network error');
  };
}

test('parses valid swedish_counties JSON and builds lookup', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

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
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.getPrimaryIataForIata('STO'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('ARN'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('BMA'), 'STO');
  assert.equal(lookup.getPrimaryIataForIata('MMX'), 'MMX');
  assert.equal(lookup.getPrimaryIataForIata('AGH'), 'MMX');
  assert.equal(lookup.getPrimaryIataForIata('GOT'), 'GOT');
  assert.equal(lookup.getPrimaryIataForIata('XXX'), undefined);
});

test('isPrimaryIata returns true only for primary IATA codes', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

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
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.getCorrectionForIata('STO'), undefined);
  assert.equal(lookup.getCorrectionForIata('MMX'), undefined);
  assert.equal(lookup.getCorrectionForIata('GOT'), undefined);
});

test('getCorrectionForIata returns correction for secondary IATA codes', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.getCorrectionForIata('AGH'), 'Tills observer byter till korrekt IATA MMX för Skåne län');
  assert.equal(lookup.getCorrectionForIata('ARN'), 'Tills observer byter till korrekt IATA STO för Stockholms län');
  assert.equal(lookup.getCorrectionForIata('GSE'), 'Tills observer byter till korrekt IATA GOT för Västra Götalands län');
});

test('getCorrectionForIata returns undefined for unknown IATA codes', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.getCorrectionForIata('XXX'), undefined);
  assert.equal(lookup.getCorrectionForIata('CPH'), undefined);
});

test('getAllCountyNames returns all IATA codes mapped to county name', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  const names = lookup.getAllCountyNames();
  assert.equal(names['STO'], 'Stockholms län');
  assert.equal(names['ARN'], 'Stockholms län');
  assert.equal(names['MMX'], 'Skåne län');
  assert.equal(names['AGH'], 'Skåne län');
  assert.equal(names['GOT'], 'Västra Götalands län');
  assert.equal(names['XXX'], undefined);
});

test('normalizes IATA codes with trim and uppercase', async () => {
  const lookup = await createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          swedish_counties: [
            {
              name: 'Test Län',
              primary_iata: ' tst ',
              county_code: 'se99',
              iata_codes: [' tst ', ' abc ', ' XYZ '],
            },
          ],
        };
      },
    }),
  });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('TST'), 'Test Län');
  assert.equal(lookup.getCountyForIata('abc'), 'Test Län');
  assert.equal(lookup.getCountyForIata('xyz'), 'Test Län');
  assert.equal(lookup.isPrimaryIata('TST'), true);
  assert.equal(lookup.isPrimaryIata('abc'), false);
  assert.equal(lookup.getPrimaryIataForIata('xyz'), 'TST');
});

test('returns fallback when HTTP fetch fails', async () => {
  mockFetchError();
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
  assert.equal(lookup.getPrimaryIataForIata('STO'), undefined);
});

test('returns fallback when HTTP status is not OK', async () => {
  mockFetch({ error: 'Not found' }, 404);
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
});

test('returns fallback when JSON is missing swedish_counties array', async () => {
  mockFetch({ metadata: {} });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
});

test('returns fallback when JSON is empty object', async () => {
  mockFetch({});
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
});

test('getAllCountyNames is empty when lookup is unavailable', async () => {
  mockFetchError();
  const lookup = await createSwedishCountiesLookup();

  assert.deepEqual(lookup.getAllCountyNames(), {});
});

test('isAvailable returns false when no valid counties loaded', async () => {
  mockFetch({ swedish_counties: [] });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyForIata('STO'), undefined);
});

test('validates county entries and skips invalid ones', async () => {
  const lookup = await createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          swedish_counties: [
            { name: 'Valid', primary_iata: 'ABC', county_code: 'se01', iata_codes: ['ABC'] },
            { name: '', primary_iata: 'DEF', county_code: 'se02', iata_codes: ['DEF'] },
            { name: 'NoPrimary', primary_iata: '', county_code: 'se03', iata_codes: ['GHI'] },
            { name: 'BadPrimary', primary_iata: 'INVALID', county_code: 'se04', iata_codes: ['INVALID'] },
            { name: 'NoArray', primary_iata: 'JKL', county_code: 'se05' },
            { name: 'PrimaryMissing', primary_iata: 'MNO', county_code: 'se06', iata_codes: ['PQR'] },
            { name: 'Null', primary_iata: null, county_code: 'se07', iata_codes: ['STU'] },
          ],
        };
      },
    }),
  });

  assert.equal(lookup.isAvailable(), true);
  assert.equal(lookup.getCountyForIata('ABC'), 'Valid');
  assert.equal(lookup.getCountyForIata('DEF'), undefined);
  assert.equal(lookup.getCountyForIata('GHI'), undefined);
  assert.equal(lookup.getCountyForIata('JKL'), undefined);
  assert.equal(lookup.getCountyForIata('PQR'), undefined);
  assert.equal(lookup.getCountyForIata('MNO'), undefined);
});

test('lookup is unavailable when all entries are invalid', async () => {
  const lookup = await createSwedishCountiesLookup({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          swedish_counties: [
            { name: '', primary_iata: 'ABC', county_code: 'se01', iata_codes: ['ABC'] },
            { name: 'Bad', primary_iata: null, county_code: 'se02', iata_codes: ['DEF'] },
          ],
        };
      },
    }),
  });

  assert.equal(lookup.isAvailable(), false);
});

test('injected fetchImpl is used instead of global fetch', async () => {
  let called = false;
  const lookup = await createSwedishCountiesLookup({
    fetchImpl: async () => {
      called = true;
      return {
        ok: true,
        status: 200,
        async json() {
          return { swedish_counties: [{ name: 'Test', primary_iata: 'AAA', county_code: 'se01', iata_codes: ['AAA'] }] };
        },
      };
    },
  });

  assert.equal(called, true);
  assert.equal(lookup.isAvailable(), true);
});

test('handles fetch timeout gracefully', async () => {
  const slowFetch = async () => {
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, status: 200, async json() { return { swedish_counties: [] }; } };
  };

  const lookup = await createSwedishCountiesLookup({ fetchImpl: slowFetch, timeoutMs: 1 });
  assert.equal(lookup.isAvailable(), false);
});
