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

test('Dockerfile Node major matches .node-version and patches base packages', async () => {
  const nodeVersion = (await readFile(path.join(projectDir, '.node-version'), 'utf8')).trim();
  const nodeMajor = nodeVersion.split('.')[0];
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, new RegExp(`^FROM node:${nodeMajor}(?:\\.\\d+\\.\\d+)?-bookworm-slim$`, 'm'));
  assert.match(dockerfile, /apt-get update/);
  assert.match(dockerfile, /apt-get upgrade -y/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
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

test('bridge workflow scans the built image with Docker Scout before upload', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-bridge.yml'),
    'utf8'
  );

  assert.match(workflow, /uses: docker\/scout-action@v1/);
  assert.match(workflow, /command: cves/);
  assert.match(workflow, /image: archive:\/\/\/tmp\/bridge-image\.tar/);
  assert.match(workflow, /only-severities: critical,high/);
  assert.match(workflow, /only-fixed: true/);
  assert.match(workflow, /exit-code: true/);
  assert.match(workflow, /write-comment: false/);
  assert.ok(
    workflow.indexOf('Docker Scout bridge image') > workflow.indexOf('Build bridge image'),
    'Docker Scout should run after the bridge image build'
  );
  assert.ok(
    workflow.indexOf('Docker Scout bridge image') < workflow.indexOf('Upload bridge image artifact'),
    'Docker Scout should run before uploading the bridge image artifact'
  );
});

test('bridge lockfile pins the fixed esbuild release used by tsx', async () => {
  const lockfile = await readJson('package-lock.json');

  assert.equal(lockfile.packages['node_modules/esbuild'].version, '0.28.1');
  assert.equal(lockfile.packages['node_modules/@esbuild/linux-x64'].version, '0.28.1');
});