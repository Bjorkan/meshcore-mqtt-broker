import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, '..');

async function readJson(fileName) {
  const content = await readFile(path.join(projectDir, fileName), 'utf8');
  return JSON.parse(content);
}

test('package remains an ESM broker package', async () => {
  const pkg = await readJson('package.json');

  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'dist/server.js');
  assert.equal(pkg.scripts.build, 'tsc');
  assert.equal(pkg.scripts.test, 'npm run build && node --test tests/*.test.mjs');
});

test('TypeScript config uses Node ESM resolution without deprecation workaround', async () => {
  const tsconfig = await readJson('tsconfig.json');
  const options = tsconfig.compilerOptions;

  assert.equal(options.module, 'Node20');
  assert.equal(options.moduleResolution, 'node16');
  assert.notEqual(options.moduleResolution, 'node');
  assert.notEqual(options.moduleResolution, 'node10');
  assert.equal(Object.hasOwn(options, 'ignoreDeprecations'), false);
});

test('Dockerfile Node major matches .node-version', async () => {
  const nodeVersion = (await readFile(path.join(projectDir, '.node-version'), 'utf8')).trim();
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, new RegExp(`^FROM node:${nodeVersion}-bookworm-slim$`, 'm'));
});
