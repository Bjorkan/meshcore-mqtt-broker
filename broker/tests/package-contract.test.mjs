import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from '@jest/globals';
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
  assert.equal(pkg.bin['mc-mqtt'], 'dist/cli.js');
  assert.match(pkg.scripts.build, /^tsc && esbuild src\/dashboard-client\.tsx /);
  assert.equal(
    pkg.scripts.test,
    'npm run build && node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand'
  );
  assert.equal(
    pkg.scripts['test:ci'],
    'npm run build && node --expose-gc --experimental-vm-modules node_modules/jest/bin/jest.js --ci --runInBand --verbose --showSeed --logHeapUsage --detectOpenHandles'
  );
  assert.equal(Object.hasOwn(pkg.devDependencies, 'jest'), true);
  assert.equal(Object.hasOwn(pkg.devDependencies, '@jest/globals'), true);
  assert.equal(Object.hasOwn(pkg.dependencies, 'websocket-stream'), false);
});

test('TypeScript config uses Node ESM resolution without deprecation workaround', async () => {
  const tsconfig = await readJson('tsconfig.json');
  const options = tsconfig.compilerOptions;

  assert.equal(options.module, 'NodeNext');
  assert.equal(options.moduleResolution, 'NodeNext');
  assert.notEqual(options.moduleResolution, 'node');
  assert.notEqual(options.moduleResolution, 'node10');
  assert.notEqual(options.module, 'Node20');
  assert.equal(Object.hasOwn(options, 'ignoreDeprecations'), false);
});

test('Jest runs ESM integration tests without TypeScript transforms', async () => {
  const config = (await import(path.join(projectDir, 'jest.config.mjs'))).default;

  assert.equal(config.displayName, 'broker');
  assert.equal(config.testEnvironment, 'node');
  assert.deepEqual(config.testMatch, ['<rootDir>/tests/**/*.test.mjs']);
  assert.deepEqual(config.transform, {});
  assert.equal(config.injectGlobals, false);
  assert.equal(config.clearMocks, true);
  assert.equal(config.restoreMocks, true);
  assert.equal(config.testTimeout, 30_000);
  assert.equal(config.slowTestThreshold, 10);
  assert.equal(config.openHandlesTimeout, 5_000);
  assert.equal(config.waitForUnhandledRejections, true);
});

test('Dockerfile builds and runs on the configured Node major', async () => {
  const nodeVersion = (await readFile(path.join(projectDir, '.node-version'), 'utf8')).trim();
  const nodeMajor = nodeVersion.split('.')[0];
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, new RegExp(`^FROM node:${nodeMajor}(?:\\.\\d+\\.\\d+)?-bookworm-slim AS build$`, 'm'));
  assert.match(dockerfile, new RegExp(`^FROM node:${nodeMajor}(?:\\.\\d+\\.\\d+)?-bookworm-slim AS runtime$`, 'm'));
  assert.match(dockerfile, /^RUN npm run build \\$/m);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /^HEALTHCHECK --interval=45s --timeout=50s --start-period=20s --retries=3 CMD \["node", "dist\/healthcheck\.js"\]$/m);
  assert.match(dockerfile, /chmod \+x \/usr\/local\/bin\/docker-entrypoint\.sh \/app\/dist\/cli\.js/);
  assert.match(dockerfile, /ln -s \/app\/dist\/cli\.js \/usr\/local\/bin\/mc-mqtt/);
  assert.match(dockerfile, /^CMD \["node", "dist\/server\.js"\]$/m);
});

test('Docker healthcheck verifies both MQTT loopback and Valkey readiness', async () => {
  const healthcheckSource = await readFile(path.join(projectDir, 'src/healthcheck.ts'), 'utf8');

  assert.match(healthcheckSource, /const valkeyOptions = resolveValkeyReadinessOptionsFromConfig\(\)/);
  assert.match(healthcheckSource, /await runMqttLoopbackHealthcheck\(options\)/);
  assert.match(healthcheckSource, /await runValkeyReadinessHealthcheck\(valkeyOptions\)/);
  assert.ok(
    healthcheckSource.indexOf('await runMqttLoopbackHealthcheck(options)') <
      healthcheckSource.indexOf('await runValkeyReadinessHealthcheck(valkeyOptions)'),
    'healthcheck should validate Valkey readiness during the same Docker healthcheck run'
  );
});

test('Docker runtime image removes bundled npm CVE surface', async () => {
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /apt-get upgrade -y --with-new-pkgs/);
  assert.match(dockerfile, /apt-get install -y --no-install-recommends libcap2-bin/);
  assert.match(dockerfile, /setcap 'cap_net_bind_service=\+ep' \/usr\/local\/bin\/node/);
  assert.match(dockerfile, /apt-get purge -y --auto-remove libcap2-bin/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\* \/var\/cache\/apt\/archives\/\*/);
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
  assert.ok(
    dockerfile.indexOf('rm -rf /usr/local/lib/node_modules/npm') > dockerfile.indexOf('FROM node:24-bookworm-slim AS runtime'),
    'bundled npm should be removed in the runtime stage'
  );
});

test('Docker image drops root privileges without requiring a local data volume', async () => {
  const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8');
  const entrypoint = await readFile(path.join(projectDir, 'docker-entrypoint.sh'), 'utf8');

  assert.match(dockerfile, /COPY docker-entrypoint\.sh \/usr\/local\/bin\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["docker-entrypoint\.sh"\]/);
  assert.match(dockerfile, /^EXPOSE 8080 8883$/m);
  assert.doesNotMatch(dockerfile, /VOLUME \["\/data"\]/);
  assert.doesNotMatch(entrypoint, /chown -R node:node|mkdir -p/);
  assert.match(entrypoint, /exec su node/);
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

test('broker workflow gates Docker publishing on broker tests', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-broker.yml'),
    'utf8'
  );

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*-\s+main/);
  assert.match(workflow, /test:\s*\n\s*name: Check tests for Broker/);
  assert.match(workflow, /- name: Print Jest config\s*\n\s*run: node --experimental-vm-modules node_modules\/jest\/bin\/jest\.js --showConfig/);
  assert.match(workflow, /- name: List Jest test files\s*\n\s*run: node --experimental-vm-modules node_modules\/jest\/bin\/jest\.js --listTests/);
  assert.match(workflow, /- name: Run Jest tests with diagnostics\s*\n\s*run: npm run test:ci/);
  assert.match(workflow, /build:\s*\n\s*name: Build image for Broker[\s\S]*needs: test/);
  assert.match(workflow, /publish:\s*\n\s*name: Publish image broker[\s\S]*needs: build/);
  assert.ok(workflow.indexOf('test:') < workflow.indexOf('build:'), 'testjobbet ska definieras före build');
  assert.ok(workflow.indexOf('build:') < workflow.indexOf('publish:'), 'buildjobbet ska definieras före publish');
});

test('broker Valkey runtime uses Valkey 9 in examples and CI', async () => {
  const workflow = await readFile(
    path.join(repoDir, '.github/workflows/build-image-broker.yml'),
    'utf8'
  );
  const composeExample = await readFile(path.join(repoDir, 'compose.yaml.example'), 'utf8');
  const readme = await readFile(path.join(projectDir, 'README.md'), 'utf8');

  assert.match(workflow, /image: valkey\/valkey:9-alpine/);
  assert.match(composeExample, /image: valkey\/valkey:9-alpine/);
  assert.match(readme, /image: valkey\/valkey:9-alpine/);
  assert.doesNotMatch(workflow, /valkey\/valkey:8-alpine/);
  assert.doesNotMatch(composeExample, /valkey\/valkey:8-alpine/);
  assert.doesNotMatch(readme, /valkey\/valkey:8-alpine/);
});

test('runtime logs do not use legacy English log categories', async () => {
  const runtimeSources = await Promise.all(
    ['src/server.ts', 'src/abuse-detector.ts', 'src/rate-limiter.ts'].map((filePath) =>
      readFile(path.join(projectDir, filePath), 'utf8')
    )
  );

  const source = runtimeSources.join('\n');
  assert.doesNotMatch(
    source,
    /\[(?:CONFIG|ABUSE|SHUTDOWN|PUBLISH|AUTHZ|AUTH|INTERNAL|DISCONNECT|CLIENT|STREAM|SUBSCRIBE|ERROR|RATE_LIMIT|FILTER|UNKNOWN)\]/
  );
});

test('Valkey Aedes adapters attach error listeners', async () => {
  const orchestrationSource = await readFile(path.join(projectDir, 'src/orchestration.ts'), 'utf8');

  assert.match(orchestrationSource, /attachValkeyErrorLogger\('Aedes MQ-emitter', config\.kvUrl, mq\)/);
  assert.match(orchestrationSource, /attachValkeyErrorLogger\('Aedes persistence-anslutning', config\.kvUrl, persistenceConnection\)/);
  assert.match(orchestrationSource, /attachValkeyErrorLogger\('Aedes persistence', config\.kvUrl, persistence\)/);
});

test('Valkey runtime writes are configured with TTLs', async () => {
  const orchestrationSource = await readFile(path.join(projectDir, 'src/orchestration.ts'), 'utf8');

  assert.match(orchestrationSource, /TRUST_STATE_TTL_MS = 90 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(orchestrationSource, /pipeline\.set\(key, stateWithMetadata, 'PX', TRUST_STATE_TTL_MS\)/);
  assert.match(orchestrationSource, /packetTTL\(\) \{\s*return AEDES_PACKET_TTL_SECONDS;\s*\}/);
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
  assert.match(workflow, /only-fixed: true/);
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

test('broker lockfile does not include legacy websocket-stream dependencies', async () => {
  const lockfile = await readFile(path.join(projectDir, 'package-lock.json'), 'utf8');

  assert.doesNotMatch(lockfile, /websocket-stream/);
  assert.doesNotMatch(lockfile, /ws-3\.3\.3/);
});

test('agent guidance documents intentional fork compatibility decisions', async () => {
  const agents = await readFile(path.join(repoDir, 'AGENTS.md'), 'utf8');

  assert.match(agents, /MQTT retained publishes/);
  assert.match(agents, /Publisher subtopics/);
  assert.match(agents, /Packet payload shape/);
  assert.match(agents, /Subscriber subscribe-time policy/);
});
