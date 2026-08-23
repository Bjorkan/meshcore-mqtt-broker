import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { parsePublicMeshcoreTopic } from "../dist/mqtt-history-topic.js";

const KEY = "A".repeat(64);

test.each([
  [`meshcore/STO/${KEY}/packets`, "STO", "packets", "packets"],
  [`meshcore/STO/${KEY}/status`, "STO", "status", "status"],
  [`meshcore/STO/${KEY}/neighbors`, "STO", "neighbors", "neighbors"],
  [`meshcore/STO/${KEY}/vendor/example`, "STO", "vendor/example", "vendor"],
])("parses public MeshCore topic %s", (topic, iata, subtopic, root) => {
  const parsed = parsePublicMeshcoreTopic(topic);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.iata, iata);
  assert.equal(parsed.value.observerPublicKey, KEY);
  assert.equal(parsed.value.subtopic, subtopic);
  assert.equal(parsed.value.subtopicRoot, root);
});

test.each([
  "meshcore/STO/key/packets",
  `meshcore/sto/${KEY}/packets`,
  `meshcore/test/${KEY}/packets`,
  `meshcore/TEST/${KEY}/packets`,
  `meshcore/STO/${KEY}`,
  `meshcore/STO/${KEY}//packets`,
  `meshcore/STO/${KEY}/+`,
  `other/STO/${KEY}/packets`,
])("rejects malformed topic %s without throwing", (topic) => {
  assert.equal(parsePublicMeshcoreTopic(topic).ok, false);
});
