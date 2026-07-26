import { readFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519";
import mqtt from "mqtt";

const keyFile = "/tmp/dashboard-observer-keys.json";

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((x) => parseInt(x, 16)));
}

function makeJwt(privateKeyHex, publicKeyHex) {
  const privBytes = hexToBytes(privateKeyHex);
  const header = { alg: "EdDSA", typ: "JWT" };
  const payload = { aud: "mqtt.visual-review.example", pub: publicKeyHex };

  const enc = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const hdrEnc = enc(header);
  const payloadEnc = enc(payload);
  const toSign = `${hdrEnc}.${payloadEnc}`;

  const sig = ed25519.sign(Buffer.from(toSign), privBytes);
  const sigEnc = Buffer.from(sig).toString("base64url");

  return `${hdrEnc}.${payloadEnc}.${sigEnc}`;
}

function safeId(str) {
  return str
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

async function main() {
  const raw = await readFile(keyFile, "utf-8");
  const keyPairs = JSON.parse(raw);
  const clients = [];

  for (const { label, region, publicKey, privateKey } of keyPairs) {
    const jwt = makeJwt(privateKey, publicKey);
    const clientId = `dashboard-review-${safeId(label)}`;
    const topic = `meshcore/${region}/${publicKey}/packets`;

    await new Promise((resolve, reject) => {
      const client = mqtt.connect("ws://127.0.0.1:8883", {
        username: jwt,
        password: "",
        clientId,
        reconnectPeriod: 0,
        connectTimeout: 10000,
      });

      client.on("connect", () => {
        console.log(`Observer connected: ${label}`);
        client.publish(
          topic,
          JSON.stringify({ origin_id: publicKey, text: "dashboard test" }),
          { qos: 1 },
          () => {
            console.log(
              `Observer published: ${label} -> ${topic.slice(0, 45)}...`,
            );
            clients.push(client);
            resolve(true);
          },
        );
      });

      client.on("error", (err) => {
        console.error(`Observer error (${label}):`, err.message);
        reject(err);
      });
    });

    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`All ${clients.length} observers connected`);

  process.on("SIGTERM", () => {
    for (const c of clients) c.end();
  });
}

main().catch((err) => {
  console.error("Observer connect failed:", err);
  process.exit(1);
});
