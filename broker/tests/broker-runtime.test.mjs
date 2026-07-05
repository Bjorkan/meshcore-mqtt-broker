import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import Redis from 'ioredis';

import { createAuthToken, Utils } from '@michaelhart/meshcore-decoder';
import {
  BROKER_HEARTBEAT_MESSAGE,
  BROKER_HEARTBEAT_TOPIC,
  DEFAULT_NODE_NAME_CACHE_TTL_MS,
  startBrokerServer,
} from '../dist/server.js';
import {
  DOCKER_HEALTH_PASSWORD_LENGTH,
  DOCKER_HEALTH_USERNAME,
} from '../dist/docker-health-user.js';
import {
  TRUST_STATE_TTL_MS,
} from '../dist/orchestration.js';

const PRIVATE_KEY =
  '18469d6140447f77de13cd8d761e605431f52269fbff43b0925752ed9e6745435dc6a86d2568af8b70d3365db3f88234760c8ecc645ce469829bc45b65f1d5d5';
const PUBLIC_KEY = '4852B69364572B52EFA1B6BB3E6D0ABED4F389A1CBFBB60A9BBA2CCE649CAF0E';
const OTHER_PUBLIC_KEY = '7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400';
const AUDIENCE = 'meshcore-test-audience';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(testDir, '..');

const runtimes = [];

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop().stop();
  }
});

function clearSubscriberEnv() {
  for (const key of Object.keys(process.env)) {
    if (/^SUBSCRIBER_\d+$/.test(key)) {
      delete process.env[key];
    }
  }
  delete process.env.ALLOWED_REGIONS;
  delete process.env.BROKER_NODE_NAME_CACHE_TTL_MS;
  delete process.env.BROKER_KV_URL;
  delete process.env.BROKER_KV_NAMESPACE;
  delete process.env.BROKER_INSTANCE_ID;
  delete process.env.HEALTHCHECK_MQTT_CREDENTIALS_FILE;
}

async function startTestBroker(env = {}) {
  clearSubscriberEnv();
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'meshcore-broker-test-'));

  Object.assign(process.env, {
    MQTT_WS_PORT: '0',
    MQTT_HOST: '127.0.0.1',
    BROKER_KV_URL: process.env.TEST_BROKER_KV_URL || 'redis://127.0.0.1:6379',
    BROKER_KV_NAMESPACE: `meshcore-broker-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    BROKER_INSTANCE_ID: `test-broker-${process.pid}-${Math.random().toString(16).slice(2)}`,
    AUTH_EXPECTED_AUDIENCE: AUDIENCE,
    SUBSCRIBER_MAX_CONNECTIONS_DEFAULT: '2',
    SUBSCRIBER_1: 'viewer:viewer-pass:2:1',
    SUBSCRIBER_2: 'limited:limited-pass:3:2',
    SUBSCRIBER_3: 'admin:admin-pass:1:5',
    ABUSE_ENFORCEMENT_ENABLED: 'false',
    ABUSE_DUPLICATE_WINDOW_SIZE: '100',
    ABUSE_DUPLICATE_WINDOW_MS: '300000',
    ABUSE_DUPLICATE_THRESHOLD: '10',
    ABUSE_MAX_DUPLICATES_PER_PACKET: '5',
    ABUSE_DUPLICATE_RATE_THRESHOLD: '0.3',
    ABUSE_DUPLICATE_RATE_WINDOW_MS: '300000',
    ABUSE_BUCKET_CAPACITY: '20',
    ABUSE_BUCKET_REFILL_RATE: '3',
    ABUSE_MAX_PACKET_SIZE: '255',
    ABUSE_MAX_TOPICS_PER_DAY: '3',
    ABUSE_ANOMALY_THRESHOLD: '10',
    ABUSE_MAX_IATA_CHANGES_24H: '3',
    ABUSE_TOPIC_HISTORY_SIZE: '50',
    ABUSE_TOPIC_HISTORY_WINDOW_MS: '86400000',
    HEALTHCHECK_MQTT_CREDENTIALS_FILE: path.join(tmpDir, 'docker_health_credentials.json'),
    MQTT_JSON_PUBLISH_MAX_BYTES: '8192',
    ...env,
  });

  const runtime = await startBrokerServer();
  runtime.healthcheckCredentialsFile = process.env.HEALTHCHECK_MQTT_CREDENTIALS_FILE;
  runtimes.push(runtime);
  return runtime;
}

function fakeClient(id) {
  return {
    id,
    conn: {
      clientIP: '127.0.0.1',
      authenticated: false,
    },
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function authenticate(aedes, client, username, password) {
  return new Promise((resolve, reject) => {
    aedes.authenticate(client, username, Buffer.from(password), (err, authenticated) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(authenticated);
    });
  });
}

function authorizePublish(aedes, client, packet) {
  return new Promise((resolve, reject) => {
    aedes.authorizePublish(client, packet, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(packet);
    });
  });
}

function authorizeSubscribe(aedes, client, topic) {
  return new Promise((resolve, reject) => {
    aedes.authorizeSubscribe(client, { topic, qos: 0 }, (err, subscription) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(subscription);
    });
  });
}

function onceEvent(emitter, eventName) {
  return new Promise((resolve) => {
    emitter.once(eventName, (...args) => resolve(args));
  });
}

async function publisherClient(aedes, id = 'publisher') {
  const client = fakeClient(id);
  const token = await createAuthToken(
    {
      publicKey: PUBLIC_KEY,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    PRIVATE_KEY,
    PUBLIC_KEY
  );

  assert.equal(await authenticate(aedes, client, `v1_${PUBLIC_KEY}`, token), true);
  return client;
}

async function generatedPublisherClient(aedes, id) {
  const keyPair = await generateMeshCoreKeyPair();
  const client = fakeClient(id);
  const token = await createAuthToken(
    {
      publicKey: keyPair.publicKey,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    keyPair.privateKey,
    keyPair.publicKey
  );

  assert.equal(await authenticate(aedes, client, `v1_${keyPair.publicKey}`, token), true);
  return { client, ...keyPair };
}

async function generateMeshCoreKeyPair() {
  const seed = randomBytes(32);
  const privateKeyBytes = Buffer.from(createHash('sha512').update(seed).digest());
  privateKeyBytes[0] &= 248;
  privateKeyBytes[31] &= 63;
  privateKeyBytes[31] |= 64;

  const privateKey = privateKeyBytes.toString('hex').toUpperCase();
  const publicKey = (await Utils.derivePublicKey(privateKey)).toUpperCase();

  assert.equal(privateKey.length, 128);
  assert.equal(publicKey.length, 64);

  return { privateKey, publicKey };
}

function parseAllowedRegionsYaml(content) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*-\s*([A-Za-z]{3})\s+#\s+(.+)$/);
      return match ? { code: match[1].toUpperCase(), comment: match[2].trim() } : null;
    })
    .filter(Boolean);
}

async function readAllowedRegions() {
  const content = await readFile(path.join(projectDir, 'allowed_regions.yaml'), 'utf8');
  return parseAllowedRegionsYaml(content);
}

function valkeyClient() {
  return new Redis(process.env.TEST_BROKER_KV_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
  });
}

test('authenticates subscribers and enforces subscriber connection limits', async () => {
  const { aedes } = await startTestBroker();
  const firstViewer = fakeClient('viewer-1');
  const secondViewer = fakeClient('viewer-2');

  assert.equal(await authenticate(aedes, firstViewer, 'viewer', 'viewer-pass'), true);
  assert.equal(firstViewer.clientType, 'subscriber');
  assert.equal(firstViewer.username, 'viewer');
  assert.equal(firstViewer.role, 2);

  assert.equal(await authenticate(aedes, secondViewer, 'viewer', 'viewer-pass'), false);
  assert.equal(await authenticate(aedes, fakeClient('bad-viewer'), 'viewer', 'wrong'), false);
});

test('stores subscriber connection metadata in Valkey members', async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient('viewer-metadata');

  assert.equal(await authenticate(aedes, viewer, 'viewer', 'viewer-pass'), true);

  const redis = valkeyClient();
  try {
    const key = `${process.env.BROKER_KV_NAMESPACE}:subscribers:viewer:connections`;
    const members = await redis.zrange(key, 0, -1);
    assert.equal(members.length, 1);

    const member = JSON.parse(members[0]);
    assert.equal(member.clientId, 'viewer-metadata');
    assert.equal(member.lastUpdatedByInstance, process.env.BROKER_INSTANCE_ID);

    const ttlMs = await redis.pttl(key);
    assert.ok(ttlMs > 0);
    assert.ok(ttlMs <= 90_000);
  } finally {
    await redis.quit();
  }
});

test('creates docker_health subscriber with a generated runtime password at startup', async () => {
  const { aedes, healthcheckCredentialsFile } = await startTestBroker();
  const credentials = JSON.parse(await readFile(healthcheckCredentialsFile, 'utf8'));

  assert.equal(credentials.username, DOCKER_HEALTH_USERNAME);
  assert.equal(credentials.password.length, DOCKER_HEALTH_PASSWORD_LENGTH);

  const healthClient = fakeClient('docker-health-runtime');
  assert.equal(await authenticate(aedes, healthClient, DOCKER_HEALTH_USERNAME, credentials.password), true);
  assert.equal(healthClient.clientType, 'subscriber');
  assert.equal(healthClient.username, DOCKER_HEALTH_USERNAME);
  assert.equal(healthClient.role, 3);

  assert.equal(await authenticate(aedes, fakeClient('docker-health-wrong'), DOCKER_HEALTH_USERNAME, 'wrong-password'), false);
  assert.deepEqual(await authorizeSubscribe(aedes, healthClient, BROKER_HEARTBEAT_TOPIC), { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 });
});

test('fails fast when subscriber role override is invalid', async () => {
  await assert.rejects(
    startTestBroker({
      SUBSCRIBER_2: 'limited:limited-pass:9:2',
    }),
    /SUBSCRIBER_2/
  );
});

test('fails fast when subscriber maxConnections override is invalid', async () => {
  await assert.rejects(
    startTestBroker({
      SUBSCRIBER_2: 'limited:limited-pass:3:abc',
    }),
    /SUBSCRIBER_2/
  );
});

test('allows level 2 subscribe-only users to subscribe to meshcore wildcard', async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient('viewer-wildcard');

  assert.equal(await authenticate(aedes, viewer, 'viewer', 'viewer-pass'), true);
  assert.equal(viewer.clientType, 'subscriber');
  assert.equal(viewer.role, 2);

  const subscription = await authorizeSubscribe(aedes, viewer, 'meshcore/#');
  assert.deepEqual(subscription, { topic: 'meshcore/#', qos: 0 });
});

test('allows subscribe-only users to subscribe to broker heartbeat', async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient('viewer-heartbeat');
  const limited = fakeClient('limited-heartbeat');

  assert.equal(await authenticate(aedes, viewer, 'viewer', 'viewer-pass'), true);
  assert.equal(await authenticate(aedes, limited, 'limited', 'limited-pass'), true);

  assert.deepEqual(
    await authorizeSubscribe(aedes, viewer, BROKER_HEARTBEAT_TOPIC),
    { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 }
  );
  assert.deepEqual(
    await authorizeSubscribe(aedes, limited, BROKER_HEARTBEAT_TOPIC),
    { topic: BROKER_HEARTBEAT_TOPIC, qos: 0 }
  );
});

test('keeps non-admin subscribe-time restrictions to public topics and heartbeat', async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient('viewer-public-topic');
  const limited = fakeClient('limited-public-topic');

  assert.equal(await authenticate(aedes, viewer, 'viewer', 'viewer-pass'), true);
  assert.equal(await authenticate(aedes, limited, 'limited', 'limited-pass'), true);

  assert.deepEqual(
    await authorizeSubscribe(aedes, viewer, `meshcore/test/${PUBLIC_KEY}/status`),
    { topic: `meshcore/test/${PUBLIC_KEY}/status`, qos: 0 }
  );
  assert.deepEqual(
    await authorizeSubscribe(aedes, limited, `meshcore/test/${PUBLIC_KEY}/packets`),
    { topic: `meshcore/test/${PUBLIC_KEY}/packets`, qos: 0 }
  );

  for (const topic of [
    `meshcore/test/${PUBLIC_KEY}/internal`,
    `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    '$SYS/#',
  ]) {
    await assert.rejects(authorizeSubscribe(aedes, viewer, topic), /public meshcore topics and heartbeat/);
    await assert.rejects(authorizeSubscribe(aedes, limited, topic), /public meshcore topics and heartbeat/);
  }
});

test('publishes broker heartbeat payload for uptime checks', async () => {
  const runtime = await startTestBroker();
  const publications = [];
  const originalPublish = runtime.aedes.publish.bind(runtime.aedes);
  runtime.aedes.publish = (packet, callback) => {
    publications.push(packet);
    callback?.();
  };

  try {
    runtime.publishHeartbeat();
  } finally {
    runtime.aedes.publish = originalPublish;
  }

  assert.equal(publications.length, 1);
  assert.equal(publications[0].topic, BROKER_HEARTBEAT_TOPIC);
  assert.equal(publications[0].payload.toString(), BROKER_HEARTBEAT_MESSAGE);
  assert.equal(publications[0].retain, false);
});

test('authenticates signed publishers and authorizes matching meshcore publishes', async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes);
  const internalPublishes = [];
  const originalPublish = aedes.publish.bind(aedes);
  aedes.publish = (packet, callback) => {
    internalPublishes.push(packet);
    callback?.();
  };

  try {
    const packet = {
      topic: `meshcore/TEST/${PUBLIC_KEY.toLowerCase()}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: '00' })),
      retain: false,
    };

    await authorizePublish(aedes, client, packet);

    assert.equal(packet.topic, `meshcore/test/${PUBLIC_KEY}/packets`);
    assert.equal(internalPublishes.length, 1);
    assert.equal(internalPublishes[0].topic, `meshcore/test/${PUBLIC_KEY}/internal`);
    assert.equal(internalPublishes[0].retain, false);

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/packets`,
        payload: Buffer.from(JSON.stringify({ raw: '00' })),
        retain: false,
      }),
      /origin_id/
    );

    const mismatchPacket = {
      topic: `meshcore/test/${OTHER_PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
      retain: false,
    };

    await assert.rejects(authorizePublish(aedes, client, mismatchPacket), /Public key/);
    assert.equal(client.closed, true);
  } finally {
    aedes.publish = originalPublish;
  }
});

test('stores trust-state write metadata in Valkey', async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, 'publisher-valkey-metadata');
  const beforeWrite = Date.now();

  await authorizePublish(aedes, client, {
    cmd: 'publish',
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(JSON.stringify({
      origin_id: PUBLIC_KEY,
      timestamp: new Date().toISOString(),
      origin: 'SE-STO-META',
    })),
    qos: 0,
    retain: false,
    dup: false,
  });

  const redis = valkeyClient();
  try {
    const key = `${process.env.BROKER_KV_NAMESPACE}:abuse:trust:${PUBLIC_KEY}`;
    const rawState = await redis.get(key);
    assert.ok(rawState);

    const state = JSON.parse(rawState);
    assert.equal(state.lastUpdatedByInstance, process.env.BROKER_INSTANCE_ID);
    assert.equal(typeof state.lastUpdatedAt, 'number');
    assert.ok(state.lastUpdatedAt >= beforeWrite);
    assert.equal(state.publicKey, PUBLIC_KEY);

    const ttlMs = await redis.pttl(key);
    assert.ok(ttlMs > 0);
    assert.ok(ttlMs <= TRUST_STATE_TTL_MS);
  } finally {
    await redis.quit();
  }
});

test('authorizes regions from allowed_regions.yaml and extends them with ALLOWED_REGIONS', async () => {
  const { aedes } = await startTestBroker({ ALLOWED_REGIONS: 'XYZ' });
  const client = await publisherClient(aedes, 'publisher-regions');

  const yamlRegionPacket = {
    topic: `meshcore/STO/${PUBLIC_KEY.toLowerCase()}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY.toLowerCase(), raw: '00' })),
    retain: false,
  };

  await authorizePublish(aedes, client, yamlRegionPacket);
  assert.equal(yamlRegionPacket.topic, `meshcore/STO/${PUBLIC_KEY}/packets`);

  const envRegionPacket = {
    topic: `meshcore/XYZ/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '01' })),
    retain: false,
  };

  await authorizePublish(aedes, client, envRegionPacket);
  assert.equal(envRegionPacket.topic, `meshcore/XYZ/${PUBLIC_KEY}/packets`);

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/ZZZ/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '02' })),
      retain: false,
    }),
    /not allowed/
  );
});

test('authorizes every allowed region with a fresh MeshCore key pair at runtime', async () => {
  const allowedRegions = await readAllowedRegions();
  assert.equal(allowedRegions.length, 53);
  assert.equal(new Set(allowedRegions.map((region) => region.code)).size, allowedRegions.length);
  assert.ok(allowedRegions.every((region) => region.comment.length > 0));

  const { aedes } = await startTestBroker();
  const originalPublish = aedes.publish.bind(aedes);
  aedes.publish = (_packet, callback) => callback?.();

  try {
    console.log(`Startar publiceringstest för ${allowedRegions.length} regioner i allowed_regions.yaml`);

    for (const { code } of allowedRegions) {
      const { client, publicKey } = await generatedPublisherClient(aedes, `publisher-${code}`);
      console.log(
        `Försöker med ${code}, giltig MeshCore-nyckel, prefix ${publicKey.substring(0, 8)} (finns i allowed_regions.yaml)`
      );
      const packet = {
        topic: `meshcore/${code}/${publicKey.toLowerCase()}/packets`,
        payload: Buffer.from(JSON.stringify({ origin_id: publicKey.toLowerCase(), raw: '00' })),
        retain: false,
      };

      await authorizePublish(aedes, client, packet);
      assert.equal(packet.topic, `meshcore/${code}/${publicKey}/packets`);
      assert.equal(client.closed, false);
      console.log(`Publicering lyckades för ${code}, fortsätter...`);
    }

    console.log('Alla tillåtna regioner passerade publiceringstestet');
  } finally {
    aedes.publish = originalPublish;
  }
});

test('allows publishers to switch between allowed IATAs including GOT under abuse enforcement', async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: 'true',
    ABUSE_MAX_IATA_CHANGES_24H: '1',
  });
  const client = await publisherClient(aedes, 'publisher-iata-switch');

  const regions = ['GSE', 'GOT', 'STO', 'ARN', 'MMX', 'GOT'];
  for (const [index, region] of regions.entries()) {
    const packet = {
      topic: `meshcore/${region}/${PUBLIC_KEY.toLowerCase()}/packets`,
      payload: Buffer.from(JSON.stringify({
        origin_id: PUBLIC_KEY.toLowerCase(),
        raw: index.toString(16).padStart(2, '0'),
      })),
      retain: false,
    };

    await authorizePublish(aedes, client, packet);
    assert.equal(packet.topic, `meshcore/${region}/${PUBLIC_KEY}/packets`);
  }

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, 'allowed');
  assert.equal(trustState.muteReason, undefined);
  assert.equal(trustState.currentIata, 'GOT');
  assert.deepEqual(trustState.iataHistory.map((entry) => entry.iata), ['GSE', 'GOT', 'STO', 'ARN', 'MMX']);
  assert.equal(trustState.iataChangeCount24h, 5);
});

test('rejects invalid MeshCore keys and regions outside the allowlist', async () => {
  const { aedes } = await startTestBroker();
  const valid = await generatedPublisherClient(aedes, 'publisher-valid-negative');

  console.log('Startar negativa publiceringstest för ogiltiga MeshCore-nycklar och regionkoder');
  console.log('Försöker autentisera med ogiltig MeshCore-nyckel i användarnamnet: NOT_A_MESHCORE_KEY');
  assert.equal(
    await authenticate(aedes, fakeClient('bad-short-key'), 'v1_NOT_A_MESHCORE_KEY', 'bad-token'),
    false
  );
  console.log('Autentisering nekades för ogiltig MeshCore-nyckel, fortsätter...');

  const otherKeyPair = await generateMeshCoreKeyPair();
  const wrongPublicKeyToken = await createAuthToken(
    {
      publicKey: otherKeyPair.publicKey,
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    otherKeyPair.privateKey,
    otherKeyPair.publicKey
  );

  console.log(
    `Försöker autentisera med nyckelprefix ${valid.publicKey.substring(0, 8)} men token signerad för prefix ${otherKeyPair.publicKey.substring(0, 8)}`
  );
  assert.equal(
    await authenticate(aedes, fakeClient('bad-mismatched-token'), `v1_${valid.publicKey}`, wrongPublicKeyToken),
    false
  );
  console.log('Autentisering nekades för felaktig tokensignatur, fortsätter...');

  const wrongAudience = 'fel-audience';
  const wrongAudienceToken = await createAuthToken(
    {
      publicKey: valid.publicKey,
      aud: wrongAudience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    valid.privateKey,
    valid.publicKey
  );

  console.log(
    `Försöker autentisera med giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)}, men ogiltig audience: ${wrongAudience}`
  );
  assert.equal(
    await authenticate(aedes, fakeClient('bad-audience-token'), `v1_${valid.publicKey}`, wrongAudienceToken),
    false
  );
  console.log('Autentisering nekades för ogiltig audience, fortsätter...');

  const invalidTopicKeyClient = fakeClient('bad-topic-key-client');
  Object.assign(invalidTopicKeyClient, {
    clientType: 'publisher',
    publicKey: valid.publicKey,
    tokenPayload: { aud: AUDIENCE },
  });

  console.log(
    `Försöker publicera till STO med ogiltig MeshCore-nyckel i ämnet, giltigt klientprefix ${valid.publicKey.substring(0, 8)}`
  );
  await assert.rejects(
    authorizePublish(aedes, invalidTopicKeyClient, {
      topic: 'meshcore/STO/NOT_A_MESHCORE_KEY/packets',
      payload: Buffer.from(JSON.stringify({ origin_id: valid.publicKey, raw: '00' })),
      retain: false,
    }),
    /Topic/
  );
  assert.equal(invalidTopicKeyClient.closed, false);
  console.log('Publicering nekades för ogiltig MeshCore-nyckel i ämnet, fortsätter...');

  for (const region of ['CPH', 'OSL', 'ZZZ']) {
    console.log(
      `Försöker med ${region}, giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)} (saknas i allowed_regions.yaml)`
    );
    await assert.rejects(
      authorizePublish(aedes, valid.client, {
        topic: `meshcore/${region}/${valid.publicKey}/packets`,
        payload: Buffer.from(JSON.stringify({ origin_id: valid.publicKey, raw: '01' })),
        retain: false,
      }),
      /not allowed/
    );
    console.log(`Publicering nekades för ${region} som förväntat, fortsätter...`);
  }

  const invalidRegionFormats = [
    { region: 'SE1', reason: 'innehåller siffra' },
    { region: 'ABCD', reason: 'har fyra tecken' },
    { region: 'sto', reason: 'är inte versal' },
    { region: 'XXX', reason: 'är en platshållare' },
  ];

  for (const { region, reason } of invalidRegionFormats) {
    const invalidRegionClient = fakeClient(`bad-region-${region}`);
    Object.assign(invalidRegionClient, {
      clientType: 'publisher',
      publicKey: valid.publicKey,
      tokenPayload: { aud: AUDIENCE },
    });

    console.log(
      `Försöker med ${region}, giltig MeshCore-nyckel, prefix ${valid.publicKey.substring(0, 8)} (ogiltig IATA-kod: ${reason})`
    );
    await assert.rejects(
      authorizePublish(aedes, invalidRegionClient, {
        topic: `meshcore/${region}/${valid.publicKey}/packets`,
        payload: Buffer.from(JSON.stringify({ origin_id: valid.publicKey, raw: '02' })),
        retain: false,
      }),
      /Topic|Location|XXX/
    );
    assert.equal(invalidRegionClient.closed, region === 'XXX');
    console.log(`Publicering nekades för ${region} som förväntat, fortsätter...`);
  }

  console.log('Alla negativa publiceringstest passerade');
});

test('enforces subscriber and publisher publish/subscribe policy edges', async () => {
  const { aedes } = await startTestBroker();
  const viewer = fakeClient('viewer-policy');
  const admin = fakeClient('admin-policy');
  const publisher = await publisherClient(aedes, 'publisher-policy');

  assert.equal(await authenticate(aedes, viewer, 'viewer', 'viewer-pass'), true);
  assert.equal(await authenticate(aedes, admin, 'admin', 'admin-pass'), true);

  await assert.rejects(
    authorizePublish(aedes, viewer, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from('{}'),
      retain: false,
    }),
    /subscribe-only/
  );

  await authorizePublish(aedes, admin, {
    topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`,
    payload: Buffer.from('command'),
    retain: true,
  });

  await assert.rejects(
    authorizePublish(aedes, publisher, {
      topic: `meshcore/test/${PUBLIC_KEY}/internal`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, forged: true })),
      retain: false,
    }),
    /broker-owned/
  );

  await assert.rejects(
    authorizePublish(aedes, publisher, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, command: 'bad' })),
      retain: false,
    }),
    /admin-only/
  );

  const retainedPacket = {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '00' })),
    retain: true,
  };
  await authorizePublish(aedes, publisher, retainedPacket);
  assert.equal(retainedPacket.retain, false);

  await assert.rejects(authorizeSubscribe(aedes, publisher, 'meshcore/#'), /publish-only/);
  assert.equal(publisher.closed, true);
});

test('restricts publisher serial command subscriptions to exact own allowed topic', async () => {
  const { aedes } = await startTestBroker();
  const publisher = await publisherClient(aedes, 'publisher-serial-subscribe');

  assert.deepEqual(
    await authorizeSubscribe(aedes, publisher, `meshcore/test/${PUBLIC_KEY}/serial/commands`),
    { topic: `meshcore/test/${PUBLIC_KEY}/serial/commands`, qos: 0 }
  );

  for (const topic of [
    `meshcore/+/${PUBLIC_KEY}/serial/commands`,
    `meshcore/test/${OTHER_PUBLIC_KEY}/serial/commands`,
    `meshcore/XXX/${PUBLIC_KEY}/serial/commands`,
    `meshcore/test/${PUBLIC_KEY}/serial/commands/extra`,
  ]) {
    const deniedPublisher = await publisherClient(aedes, `publisher-denied-${topic.length}`);
    await assert.rejects(authorizeSubscribe(aedes, deniedPublisher, topic), /publish-only/);
    assert.equal(deniedPublisher.closed, true);
  }
});

test('allows upstream-compatible publisher subtopics and strips retain globally', async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, 'publisher-observer-policy');
  const originalPublish = aedes.publish.bind(aedes);
  aedes.publish = (_packet, callback) => callback?.();

  try {
    for (const subtopic of ['status', 'packets', 'raw', 'debug', 'foo/bar']) {
      const packet = {
        topic: `meshcore/test/${PUBLIC_KEY}/${subtopic}`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, timestamp: '2026-01-01T00:00:00.000Z' })),
        retain: true,
      };

      await authorizePublish(aedes, client, packet);
      assert.equal(packet.retain, false);
    }

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/internal/debug`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        retain: false,
      }),
      /broker-owned/
    );

    await assert.rejects(
      authorizePublish(aedes, client, {
        topic: `meshcore/test/${PUBLIC_KEY}/serial/other`,
        payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY })),
        retain: false,
      }),
      /reserved/
    );
  } finally {
    aedes.publish = originalPublish;
  }
});

test('rejects oversized JSON publishes before normal JSON validation', async () => {
  const { aedes } = await startTestBroker({ MQTT_JSON_PUBLISH_MAX_BYTES: '128' });
  const client = await publisherClient(aedes, 'publisher-json-limit');

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, note: 'x'.repeat(200) })),
      retain: false,
    }),
    /too large/
  );
});

test('sets and enforces a WebSocket transport payload limit', async () => {
  const { port, wsServer } = await startTestBroker({ MQTT_WS_MAX_PAYLOAD_BYTES: '16' });
  assert.equal(wsServer.options.maxPayload, 16);

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await onceEvent(ws, 'open');
  ws.send(Buffer.alloc(17));

  const [code] = await onceEvent(ws, 'close');
  assert.equal(code, 1009);
});

test('enforces abuse mute decisions when enforcement is enabled', async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: 'true',
    ABUSE_BUCKET_CAPACITY: '1',
    ABUSE_BUCKET_REFILL_RATE: '0.000001',
  });
  const client = await publisherClient(aedes, 'publisher-abuse-enforced');

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '00' })),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '01' })),
      retain: false,
    }),
    /abuse policy/
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/packets`,
      payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '02' })),
      retain: false,
    }),
    /abuse policy/
  );

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, 'muted');
  assert.equal(trustState.muteReason, 'rate_limit_exceeded');
  assert.ok(trustState.totalPacketsSilenced > 0);
});

test('marks would_mute in abuse shadow mode while still allowing publishes', async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: 'false',
    ABUSE_BUCKET_CAPACITY: '1',
    ABUSE_BUCKET_REFILL_RATE: '0.000001',
  });
  const client = await publisherClient(aedes, 'publisher-abuse-shadow');

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '00' })),
    retain: false,
  });

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(JSON.stringify({ origin_id: PUBLIC_KEY, raw: '01' })),
    retain: false,
  });

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, 'would_mute');
  assert.equal(trustState.muteReason, 'rate_limit_exceeded');
});

test('applies abuse and size policy to serial response publishes', async () => {
  const { aedes, abuseDetector } = await startTestBroker({
    ABUSE_ENFORCEMENT_ENABLED: 'true',
    ABUSE_BUCKET_CAPACITY: '1',
    ABUSE_BUCKET_REFILL_RATE: '0.000001',
  });
  const client = await publisherClient(aedes, 'publisher-serial-abuse');

  await authorizePublish(aedes, client, {
    topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
    payload: Buffer.from('aaa.bbb.ccc'),
    retain: false,
  });

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from('ddd.eee.fff'),
      retain: false,
    }),
    /abuse policy/
  );

  const trustState = abuseDetector.getClientStats(PUBLIC_KEY);
  assert.equal(trustState.status, 'muted');
  assert.equal(trustState.muteReason, 'rate_limit_exceeded');
});

test('rejects oversized and malformed serial response payloads', async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes, 'publisher-serial-validation');

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from('not-a-jwt-shaped-payload'),
      retain: false,
    }),
    /JWT-shaped/
  );

  await assert.rejects(
    authorizePublish(aedes, client, {
      topic: `meshcore/test/${PUBLIC_KEY}/serial/responses`,
      payload: Buffer.from(`${'a'.repeat(4096)}.b.c`),
      retain: false,
    }),
    /too large/
  );
});

test('strips retained status publishes before authorization succeeds', async () => {
  const { aedes } = await startTestBroker();
  const client = await publisherClient(aedes);
  const packet = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: '2026-01-01T00:00:00.000Z',
      })
    ),
    retain: true,
  };

  await authorizePublish(aedes, client, packet);
  assert.equal(packet.retain, false);
});

test('caches publisher node names from status and expires them after ttl', async () => {
  assert.equal(DEFAULT_NODE_NAME_CACHE_TTL_MS, 24 * 60 * 60 * 1000);

  {
    const { aedes } = await startTestBroker();
    const first = await publisherClient(aedes, 'publisher-name-source');
    await authorizePublish(aedes, first, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          origin: 'SE-STO-TEST',
          timestamp: '2026-01-01T00:00:00.000Z',
        })
      ),
      retain: false,
    });

    const second = await publisherClient(aedes, 'aedes_generated_client_id');
    assert.equal(second.nodeName, 'SE-STO-TEST');
  }

  {
    const { aedes } = await startTestBroker({ BROKER_NODE_NAME_CACHE_TTL_MS: '1' });
    const first = await publisherClient(aedes, 'publisher-expiring-name-source');
    await authorizePublish(aedes, first, {
      topic: `meshcore/test/${PUBLIC_KEY}/status`,
      payload: Buffer.from(
        JSON.stringify({
          origin_id: PUBLIC_KEY,
          origin: 'SE-STO-EXPIRED',
          timestamp: '2026-01-01T00:00:00.000Z',
        })
      ),
      retain: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await publisherClient(aedes, 'aedes_generated_client_id');
    assert.equal(second.nodeName, undefined);
  }
});

test('filters forwarded data by subscriber role and blocks stale status messages', async () => {
  const { aedes } = await startTestBroker();
  const limited = { clientType: 'subscriber', role: 3 };
  const fullAccess = { clientType: 'subscriber', role: 2 };
  const admin = { clientType: 'subscriber', role: 1 };

  const packet = {
    topic: `meshcore/test/${PUBLIC_KEY}/packets`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        SNR: 12,
        RSSI: -90,
        score: 40,
        visible: true,
      })
    ),
  };

  const limitedPacket = aedes.authorizeForward(limited, packet);
  assert.deepEqual(JSON.parse(limitedPacket.payload.toString()), {
    origin_id: PUBLIC_KEY,
    visible: true,
  });

  assert.equal(aedes.authorizeForward(fullAccess, packet), packet);

  const internalPacket = {
    topic: `meshcore/test/${PUBLIC_KEY}/internal`,
    payload: Buffer.from('{}'),
  };
  assert.equal(aedes.authorizeForward(fullAccess, internalPacket), null);
  assert.equal(aedes.authorizeForward(admin, internalPacket), internalPacket);

  const newerStatus = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: '2026-01-02T00:00:00.000Z',
        model: 'secret',
        firmware_version: '1.2.3',
        stats: { uptime: 10 },
        visible: true,
      })
    ),
  };
  const olderStatus = {
    topic: `meshcore/test/${PUBLIC_KEY}/status`,
    payload: Buffer.from(
      JSON.stringify({
        origin_id: PUBLIC_KEY,
        timestamp: '2026-01-01T00:00:00.000Z',
        visible: true,
      })
    ),
  };

  const forwardedStatus = aedes.authorizeForward(limited, newerStatus);
  assert.deepEqual(JSON.parse(forwardedStatus.payload.toString()), {
    origin_id: PUBLIC_KEY,
    timestamp: '2026-01-02T00:00:00.000Z',
    visible: true,
  });
  assert.equal(aedes.authorizeForward(limited, olderStatus), null);
});
