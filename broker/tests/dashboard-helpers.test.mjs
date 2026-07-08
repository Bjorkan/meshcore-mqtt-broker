import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { formatDeniedUntilLabel, formatRegionDisplay } from '../dist/dashboard-helpers.js';

test('formatDeniedUntilLabel: would_mute returns "-"', () => {
  assert.equal(formatDeniedUntilLabel({ status: 'would_mute' }), '-');
  assert.equal(formatDeniedUntilLabel({ status: 'would_mute', deniedUntilText: 'något' }), '-');
  assert.equal(formatDeniedUntilLabel({ status: 'would_mute', mutedUntil: 123456 }), '-');
});

test('formatDeniedUntilLabel: deniedUntilText shown when present', () => {
  const result = formatDeniedUntilLabel({
    status: 'denied',
    deniedUntilText: 'Tills observer byter till korrekt IATA MMX för Skåne län',
  });
  assert.equal(result, 'Tills observer byter till korrekt IATA MMX för Skåne län');
});

test('formatDeniedUntilLabel: mutedUntil shown when deniedUntilText absent', () => {
  const result = formatDeniedUntilLabel({ status: 'muted', mutedUntil: 2000000000000 });
  assert.ok(result.includes('Europe/Stockholm'));
});

test('formatDeniedUntilLabel: "-" when nothing available', () => {
  assert.equal(formatDeniedUntilLabel({ status: 'denied' }), '-');
  assert.equal(formatDeniedUntilLabel({ status: 'muted' }), '-');
});

test('formatDeniedUntilLabel: "-" for unknown status', () => {
  assert.equal(formatDeniedUntilLabel({ status: 'unknown' }), '-');
});

test('formatRegionDisplay: null for undefined region', () => {
  assert.equal(formatRegionDisplay(undefined, {}), null);
  assert.equal(formatRegionDisplay(undefined), null);
});

test('formatRegionDisplay: just code when no lookup', () => {
  const result = formatRegionDisplay('STO');
  assert.deepEqual(result, { code: 'STO' });
});

test('formatRegionDisplay: just code when lookup empty', () => {
  const result = formatRegionDisplay('STO', {});
  assert.deepEqual(result, { code: 'STO' });
});

test('formatRegionDisplay: code only when region not in lookup', () => {
  const result = formatRegionDisplay('XXX', { STO: { countyName: 'Stockholm', primaryIata: 'STO', isPrimary: true } });
  assert.deepEqual(result, { code: 'XXX' });
});

test('formatRegionDisplay: county name and code when lookup available', () => {
  const result = formatRegionDisplay('STO', { STO: { countyName: 'Stockholms län', primaryIata: 'STO', isPrimary: true } });
  assert.deepEqual(result, { countyName: 'Stockholms län', code: 'STO' });
});

test('formatRegionDisplay: secondary IATA shows its own code, not primary', () => {
  const result = formatRegionDisplay('ARN', { ARN: { countyName: 'Stockholms län', primaryIata: 'STO', isPrimary: false } });
  assert.deepEqual(result, { countyName: 'Stockholms län', code: 'ARN' });
});
