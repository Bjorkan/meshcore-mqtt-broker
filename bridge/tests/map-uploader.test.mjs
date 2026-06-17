import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ed25519 } from '@noble/curves/ed25519.js';

import { MeshcoreMapUploader } from '../dist/map-uploader.js';

const UPLOADER_SEED = Buffer.from('11'.repeat(32), 'hex');
const ADVERT_SEED = Buffer.from('22'.repeat(32), 'hex');
const OBSERVER_ID = 'a1'.repeat(32);
const API_URL = 'https://map.meshcore.io/api/v1/uploader/node';

const advertTypes = {
  none: 0,
  chat: 1,
  repeater: 2,
  room: 3,
  sensor: 4,
};

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function makeConfig(overrides = {}) {
  return {
    enabled: true,
    publicKey: hex(ed25519.getPublicKey(UPLOADER_SEED)),
    privateKey: hex(UPLOADER_SEED),
    apiUrl: API_URL,
    minReuploadIntervalSeconds: 3600,
    requestTimeoutMs: 10000,
    retryCooldownMs: 300000,
    requireCompleteRadioParams: true,
    ...overrides,
  };
}

function makeFetch({ ok = true, status = 200, text = '{"ok":true}' } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return {
      ok,
      status,
      text: async () => text,
    };
  };

  return { fetch, requests };
}

function makeAdvertPacket({
  seed = ADVERT_SEED,
  timestamp = 1_800_000_000,
  name = 'SE-STO-TEST',
  type = advertTypes.repeater,
  tamperSignature = false,
}) {
  const publicKey = Buffer.from(ed25519.getPublicKey(seed));
  const appData = Buffer.concat([
    Buffer.from([0x80 | type]),
    Buffer.from(name, 'utf8'),
  ]);
  const signed = Buffer.concat([publicKey, u32le(timestamp), appData]);
  const signature = Buffer.from(ed25519.sign(signed, seed));
  if (tamperSignature) {
    signature[0] ^= 0xff;
  }

  const payload = Buffer.concat([publicKey, u32le(timestamp), signature, appData]);
  return Buffer.concat([
    Buffer.from([(0x04 << 2) | 0x01, 0x00]),
    payload,
  ]);
}

function statusPayload(overrides = {}) {
  return Buffer.from(JSON.stringify({
    origin: 'SE-STO-OBSERVER',
    origin_id: OBSERVER_ID,
    radio: '869.617981,62.5,8,8',
    ...overrides,
  }));
}

async function rememberDefaultStatus(uploader) {
  await uploader.processMqttMessage(`meshcore/STO/${OBSERVER_ID}/status`, statusPayload());
}

function signedRequestData(requests) {
  const requestBody = JSON.parse(requests[0].init.body);
  return JSON.parse(requestBody.data);
}

test('uploads verified packets.raw adverts with firmware radio parameters', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await rememberDefaultStatus(uploader);

  const packet = makeAdvertPacket({});
  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/packets`,
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, type: 'PACKET', raw: hex(packet) }))
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, API_URL);
  assert.equal(requests[0].init.headers['content-type'], 'application/json');

  const requestBody = JSON.parse(requests[0].init.body);
  assert.equal(requestBody.publicKey, hex(ed25519.getPublicKey(UPLOADER_SEED)));
  assert.match(requestBody.signature, /^[0-9a-f]{128}$/);

  const data = signedRequestData(requests);
  assert.deepEqual(data.params, {
    freq: 869.617981,
    bw: 62.5,
    sf: 8,
    cr: 8,
  });
  assert.deepEqual(data.links, [`meshcore://${hex(packet)}`]);
});

test('uploads verified raw.data adverts with human readable radio parameters', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await uploader.processMqttMessage(
    'meshcore/STO/observer-key/status',
    statusPayload({ radio: '869.617981 MHz · SF8 · BW62.5 · CR8' })
  );

  const packet = makeAdvertPacket({ timestamp: 1_800_003_700 });
  await uploader.processMqttMessage(
    'meshcore/STO/observer-key/raw',
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, type: 'RAW', data: hex(packet) }))
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(signedRequestData(requests).params, {
    freq: 869.617981,
    sf: 8,
    bw: 62.5,
    cr: 8,
  });
});

test('normalizes direct frequency fields from MHz, kHz, and Hz', async () => {
  for (const [freq, expected] of [
    [869.617981, 869.617981],
    [869617.981, 869.617981],
    [869617981, 869.617981],
  ]) {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await uploader.processMqttMessage(
      'meshcore/STO/observer-key/status',
      statusPayload({ radio: undefined, params: { freq, bw: 62500, sf: 8, cr: 8 } })
    );

    const packet = makeAdvertPacket({ timestamp: 1_800_010_000 + Math.floor(freq) });
    await uploader.processMqttMessage(
      'meshcore/STO/observer-key/raw',
      Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(packet) }))
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(signedRequestData(requests).params, {
      freq: expected,
      bw: 62.5,
      sf: 8,
      cr: 8,
    });
  }
});

test('uses 64-hex observer id from standard, meshrank, and custom topics when payload omits origin_id', async () => {
  for (const topic of [
    `meshcore/STO/${OBSERVER_ID}/raw`,
    `meshrank/uplink/token/${OBSERVER_ID}/packets`,
    `mynetwork/raw/${OBSERVER_ID}`,
  ]) {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await uploader.processMqttMessage(`mynetwork/status/${OBSERVER_ID}`, statusPayload({ origin_id: undefined }));

    const packet = makeAdvertPacket({ timestamp: 1_800_030_000 + requests.length + topic.length });
    await uploader.processMqttMessage(
      topic,
      Buffer.from(JSON.stringify({ data: hex(packet), raw: hex(packet) }))
    );

    assert.equal(requests.length, 1);
  }
});

test('normalizes uppercase observer origin_id and topic ids', async () => {
  const upperObserverId = OBSERVER_ID.toUpperCase();
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });

  await uploader.processMqttMessage(
    `meshcore/STO/${upperObserverId}/status`,
    statusPayload({ origin_id: upperObserverId })
  );

  await uploader.processMqttMessage(
    `meshcore/STO/${upperObserverId}/raw`,
    Buffer.from(JSON.stringify({
      origin_id: upperObserverId,
      data: hex(makeAdvertPacket({ timestamp: 1_800_031_000 })),
    }))
  );

  assert.equal(requests.length, 1);
});

test('skips custom topic packets without payload origin_id or 64-hex topic id', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await rememberDefaultStatus(uploader);

  const packet = makeAdvertPacket({});
  await uploader.processMqttMessage(
    'mynetwork/raw/not-a-public-key',
    Buffer.from(JSON.stringify({ data: hex(packet) }))
  );

  assert.equal(requests.length, 0);
});

test('does not keep stale radio params after a later complete but invalid status', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });

  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/status`,
    statusPayload({ radio: '869.617981,62.5,8,8' })
  );
  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/status`,
    statusPayload({ radio: '999999,62.5,8,8' })
  );

  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/raw`,
    Buffer.from(JSON.stringify({
      origin_id: OBSERVER_ID,
      data: hex(makeAdvertPacket({ timestamp: 1_800_050_000 })),
    }))
  );

  assert.equal(requests.length, 0);
});

test('keeps previous valid radio params when later status is offline or incomplete', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await rememberDefaultStatus(uploader);
  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/status`,
    Buffer.from(JSON.stringify({ status: 'offline', origin_id: OBSERVER_ID }))
  );

  const packet = makeAdvertPacket({});
  await uploader.processMqttMessage(
    `meshcore/STO/${OBSERVER_ID}/raw`,
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(packet) }))
  );

  assert.equal(requests.length, 1);
  assert.deepEqual(signedRequestData(requests).params, {
    freq: 869.617981,
    bw: 62.5,
    sf: 8,
    cr: 8,
  });
});

test('prefers packet raw over data and raw topic data over raw field', async () => {
  const packet = makeAdvertPacket({ timestamp: 1_800_060_000 });
  const junkPacket = makeAdvertPacket({ timestamp: 1_800_063_700, type: advertTypes.chat });

  {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await rememberDefaultStatus(uploader);

    await uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/packets`,
      Buffer.from(JSON.stringify({
        origin_id: OBSERVER_ID,
        data: hex(junkPacket),
        raw: hex(packet),
      }))
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(signedRequestData(requests).links, [`meshcore://${hex(packet)}`]);
  }

  {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await rememberDefaultStatus(uploader);

    await uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/raw`,
      Buffer.from(JSON.stringify({
        origin_id: OBSERVER_ID,
        data: hex(packet),
        raw: hex(junkPacket),
      }))
    );

    assert.equal(requests.length, 1);
    assert.deepEqual(signedRequestData(requests).links, [`meshcore://${hex(packet)}`]);
  }
});

test('skips adverts when radio params are complete but outside sane ranges', async () => {
  for (const radio of [
    '1,62.5,8,8',
    '869.617981,0,8,8',
    '869.617981,62.5,99,8',
    '869.617981,62.5,8,99',
  ]) {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/status`,
      statusPayload({ radio })
    );

    await uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/raw`,
      Buffer.from(JSON.stringify({
        origin_id: OBSERVER_ID,
        data: hex(makeAdvertPacket({ timestamp: 1_800_040_000 + radio.length })),
      }))
    );

    assert.equal(requests.length, 0);
  }
});

test('deduplicates the same advert when raw and packets arrive together', async () => {
  let releaseFetch;
  const requests = [];
  const uploader = new MeshcoreMapUploader(makeConfig(), {
    fetch: async (url, init) => {
      requests.push({ url, init });
      await new Promise((resolve) => {
        releaseFetch = resolve;
      });
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    },
  });
  await rememberDefaultStatus(uploader);

  const packet = makeAdvertPacket({});
  const first = uploader.processMqttMessage(
    'meshcore/STO/observer-key/packets',
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, raw: hex(packet) }))
  );
  const second = uploader.processMqttMessage(
    'meshcore/STO/observer-key/raw',
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(packet) }))
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  releaseFetch();
  await Promise.all([first, second]);
});

test('does not let an invalid in-flight copy suppress a later valid copy', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await rememberDefaultStatus(uploader);

  const invalid = makeAdvertPacket({ tamperSignature: true });
  const valid = makeAdvertPacket({});
  await Promise.all([
    uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/raw`,
      Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(invalid) }))
    ),
    uploader.processMqttMessage(
      `meshcore/STO/${OBSERVER_ID}/packets`,
      Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, raw: hex(valid) }))
    ),
  ]);

  assert.equal(requests.length, 1);
});

test('throws when map public and private keys do not match', () => {
  assert.throws(
    () => new MeshcoreMapUploader(makeConfig({ publicKey: '33'.repeat(32) })),
    /MESHCOREIO_PUBKEY matchar inte MESHCOREIO_PRIVATEKEY/
  );
});

test('skips adverts until observer radio parameters are complete', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  const packet = makeAdvertPacket({});

  await uploader.processMqttMessage(
    'meshcore/STO/observer-key/raw',
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(packet) }))
  );

  assert.equal(requests.length, 0);
});

test('skips chat, none, and invalid-signature adverts', async () => {
  for (const packet of [
    makeAdvertPacket({ type: advertTypes.chat }),
    makeAdvertPacket({ type: advertTypes.none }),
    makeAdvertPacket({ tamperSignature: true }),
  ]) {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await rememberDefaultStatus(uploader);

    await uploader.processMqttMessage(
      'meshcore/STO/observer-key/raw',
      Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(packet) }))
    );

    assert.equal(requests.length, 0);
  }
});

test('uploads repeater, room, and sensor adverts only', async () => {
  for (const type of [advertTypes.repeater, advertTypes.room, advertTypes.sensor]) {
    const { fetch, requests } = makeFetch();
    const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
    await rememberDefaultStatus(uploader);

    await uploader.processMqttMessage(
      'meshcore/STO/observer-key/raw',
      Buffer.from(JSON.stringify({
        origin_id: OBSERVER_ID,
        data: hex(makeAdvertPacket({ type, timestamp: 1_800_020_000 + type })),
      }))
    );

    assert.equal(requests.length, 1);
  }
});

test('applies replay, reupload interval, and retry cooldown', async () => {
  const { fetch, requests } = makeFetch();
  let now = 10_000;
  const uploader = new MeshcoreMapUploader(makeConfig({ retryCooldownMs: 300000 }), {
    fetch,
    now: () => now,
  });
  await rememberDefaultStatus(uploader);

  const first = makeAdvertPacket({ timestamp: 1_800_000_000 });
  await uploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(first) })));
  await uploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(first) })));
  assert.equal(requests.length, 1);

  const tooSoon = makeAdvertPacket({ timestamp: 1_800_000_100 });
  await uploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(tooSoon) })));
  assert.equal(requests.length, 1);

  const later = makeAdvertPacket({ timestamp: 1_800_003_700 });
  await uploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(later) })));
  assert.equal(requests.length, 2);

  const failing = makeFetch({ ok: false, status: 500, text: 'nope' });
  const retryUploader = new MeshcoreMapUploader(makeConfig({ retryCooldownMs: 300000 }), {
    fetch: failing.fetch,
    now: () => now,
  });
  await rememberDefaultStatus(retryUploader);
  const retryPacket = makeAdvertPacket({ timestamp: 1_800_100_000 });

  await assert.rejects(
    retryUploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(retryPacket) }))),
    /map\.meshcore\.io svarade 500/
  );
  await retryUploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(retryPacket) })));
  assert.equal(failing.requests.length, 1);

  now += 300001;
  await assert.rejects(
    retryUploader.processMqttMessage('meshcore/STO/observer-key/raw', Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: hex(retryPacket) }))),
    /map\.meshcore\.io svarade 500/
  );
  assert.equal(failing.requests.length, 2);
});

test('skips oversized packet hex before parsing', async () => {
  const { fetch, requests } = makeFetch();
  const uploader = new MeshcoreMapUploader(makeConfig(), { fetch });
  await rememberDefaultStatus(uploader);

  await uploader.processMqttMessage(
    'meshcore/STO/observer-key/raw',
    Buffer.from(JSON.stringify({ origin_id: OBSERVER_ID, data: 'aa'.repeat(600) }))
  );

  assert.equal(requests.length, 0);
});
