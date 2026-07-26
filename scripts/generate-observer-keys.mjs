import { writeFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";

const observers = [
  { label: "Stockholm Rooftop", region: "STO", index: 0 },
  { label: "Gothenburg Ridge", region: "GOT", index: 1 },
  { label: "Jönköping Relay", region: "JKG", index: 2 },
  { label: "Malmö Shadow Mode", region: "MMX", index: 3 },
  { label: "Chatty Node", region: "STO", index: 4 },
  {
    label:
      "Very Long Observer Name That Might Overflow Table Cells In Some Viewports",
    region: "STO",
    index: 5,
  },
];

const keyPairs = [];

for (const obs of observers) {
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = (obs.index * 37 + i * 17) & 0xff;
  }
  const privKey = seed;
  const pubKey = ed25519.getPublicKey(privKey);
  const publicKey = Array.from(pubKey, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  keyPairs.push({
    label: obs.label,
    region: obs.region,
    publicKey,
    privateKey: Array.from(privKey, (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase(),
  });

  console.log(`Generated key for: ${obs.label} (${publicKey.slice(0, 10)}...)`);
}

writeFileSync(
  "/tmp/dashboard-observer-keys.json",
  JSON.stringify(keyPairs, null, 2),
);
console.log(
  `Wrote ${keyPairs.length} observer key pairs to /tmp/dashboard-observer-keys.json`,
);
