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
  globalThis.fetch = async (url, options) => {
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
  assert.equal(lookup.getCountyName('STO'), 'Stockholms län');
  assert.equal(lookup.getCountyName('ARN'), 'Stockholms län');
  assert.equal(lookup.getCountyName('BMA'), 'Stockholms län');
  assert.equal(lookup.getCountyName('MMX'), 'Skåne län');
  assert.equal(lookup.getCountyName('AGH'), 'Skåne län');
  assert.equal(lookup.getCountyName('GOT'), 'Västra Götalands län');
  assert.equal(lookup.getCountyName('XXX'), undefined);
});

test('getPrimaryIata returns primary IATA for any IATA in the county', async () => {
  mockFetch({ swedish_counties: TEST_COUNTIES });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.getPrimaryIata('STO'), 'STO');
  assert.equal(lookup.getPrimaryIata('ARN'), 'STO');
  assert.equal(lookup.getPrimaryIata('BMA'), 'STO');
  assert.equal(lookup.getPrimaryIata('MMX'), 'MMX');
  assert.equal(lookup.getPrimaryIata('AGH'), 'MMX');
  assert.equal(lookup.getPrimaryIata('GOT'), 'GOT');
  assert.equal(lookup.getPrimaryIata('XXX'), undefined);
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

test('returns fallback when HTTP fetch fails', async () => {
  mockFetchError();
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyName('STO'), undefined);
  assert.equal(lookup.getPrimaryIata('STO'), undefined);
});

test('returns fallback when HTTP status is not OK', async () => {
  mockFetch({ error: 'Not found' }, 404);
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyName('STO'), undefined);
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

test('isAvailable returns false when no counties loaded', async () => {
  mockFetch({ swedish_counties: [] });
  const lookup = await createSwedishCountiesLookup();

  assert.equal(lookup.isAvailable(), false);
  assert.equal(lookup.getCountyName('STO'), undefined);
});
