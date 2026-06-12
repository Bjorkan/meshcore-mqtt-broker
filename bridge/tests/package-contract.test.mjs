import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, '..');
const repoDir = path.resolve(projectDir, '..');

async function readJson(fileName) {
  const content = await readFile(path.join(projectDir, fileName), 'utf8');
  return JSON.parse(content);
}

test('package remains an ESM TypeScript bridge package', async () => {
  const pkg = await readJson('package.json');

  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'dist/bridge.js');
  assert.equal(pkg.scripts.build, 'tsc');
  assert.equal(pkg.scripts.test, 'npm run build && node --test tests/*.test.mjs');
  assert.equal(pkg.scripts.start, 'tsx src/bridge.ts');
});

test('TypeScript config uses Node ESM resolution', async () => {
  const tsconfig = await readJson('tsconfig.json');
  const options = tsconfig.compilerOptions;

  assert.equal(options.module, 'Node20');
  assert.equal(options.moduleResolution, 'node16');
  assert.equal(options.rootDir, './src');
  assert.equal(options.outDir, './dist');
  assert.equal(options.strict, true);
});

test('Dockerfile Node major matches .node-version and copies TypeScript sources', async () => {
  const nodeVersion = (await readFile(path.join(projectDir, '.node-version'), 'utf8')).trim();
  const nodeMajor = nodeVersion.split('.')[0];
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, new RegExp(`^FROM node:${nodeMajor}(?:\\.\\d+\\.\\d+)?-bookworm-slim$`, 'm'));
  assert.match(dockerfile, /^COPY tsconfig\.json \.\/$/m);
  assert.match(dockerfile, /^COPY src \.\/src$/m);
});

test('bridge workflow runs for bridge code and workflow changes', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-bridge.yml'),
    'utf8'
  );

  assert.match(workflow, /- bridge\/\*\*/);
  assert.match(workflow, /- \.github\/workflows\/build-image-bridge\.yml/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /uses: actions\/download-artifact@v7/);
  assert.match(workflow, /name: bridge-image/);
  assert.doesNotMatch(workflow, /archive: false/);
});

test('bridge workflow publishes to Docker Hub and GitHub Packages', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-bridge.yml'),
    'utf8'
  );

  assert.match(workflow, /packages: write/);
  assert.match(workflow, /registry: ghcr\.io/);
  assert.match(workflow, /bjorkan\/meshcore-mqtt-broker-bridge:latest/);
  assert.match(workflow, /bjorkan\/meshcore-mqtt-broker-bridge:sha-\$\{SHORT_SHA\}/);
  assert.match(workflow, /ghcr\.io\/bjorkan\/meshcore-mqtt-broker-bridge:latest/);
  assert.match(workflow, /ghcr\.io\/bjorkan\/meshcore-mqtt-broker-bridge:sha-\$\{SHORT_SHA\}/);
});
