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
  const nodeMajor = nodeVersion.split('.')[0];
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, new RegExp(`^FROM node:${nodeMajor}(?:\\.\\d+\\.\\d+)?-bookworm-slim$`, 'm'));
});

test('broker workflow publishes to Docker Hub and GitHub Packages', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-broker.yml'),
    'utf8'
  );

  assert.match(workflow, /- broker\/\*\*/);
  assert.match(workflow, /- \.github\/workflows\/build-image-broker\.yml/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /registry: ghcr\.io/);
  assert.match(workflow, /bjorkan\/meshcore-mqtt-broker:latest/);
  assert.match(workflow, /bjorkan\/meshcore-mqtt-broker:sha-\$\{SHORT_SHA\}/);
  assert.match(workflow, /ghcr\.io\/bjorkan\/meshcore-mqtt-broker:latest/);
  assert.match(workflow, /ghcr\.io\/bjorkan\/meshcore-mqtt-broker:sha-\$\{SHORT_SHA\}/);
});

test('broker workflow scans the built image with Docker Scout before upload', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-broker.yml'),
    'utf8'
  );

  assert.match(workflow, /uses: docker\/scout-action@v1/);
  assert.match(workflow, /command: cves/);
  assert.match(workflow, /image: archive:\/\/\/tmp\/broker-image\.tar/);
  assert.match(workflow, /only-severities: critical,high/);
  assert.match(workflow, /exit-code: true/);
  assert.match(workflow, /write-comment: false/);
  assert.ok(
    workflow.indexOf('Docker Scout broker image') > workflow.indexOf('Build broker image'),
    'Docker Scout should run after the broker image build'
  );
  assert.ok(
    workflow.indexOf('Docker Scout broker image') < workflow.indexOf('Upload broker image artifact'),
    'Docker Scout should run before uploading the broker image artifact'
  );
});
