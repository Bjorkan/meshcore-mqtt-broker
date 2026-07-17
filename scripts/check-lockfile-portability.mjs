import { readFile } from "node:fs/promises";

const lockfilePath = new URL("../package-lock.json", import.meta.url);
const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
const forbiddenHostPatterns = [
  /(^|\.)internal\.api\.openai\.org$/i,
  /(^|\.)applied-caas-gateway\d*\.internal$/i,
  /(^|\.)localhost$/i,
];
const invalidEntries = [];

for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (typeof metadata?.resolved !== "string") continue;

  let resolvedUrl;
  try {
    resolvedUrl = new URL(metadata.resolved);
  } catch {
    invalidEntries.push(
      `${packagePath || "<root>"}: invalid URL ${metadata.resolved}`,
    );
    continue;
  }

  const hasCredentials = Boolean(resolvedUrl.username || resolvedUrl.password);
  const usesForbiddenHost = forbiddenHostPatterns.some((pattern) =>
    pattern.test(resolvedUrl.hostname),
  );

  if (hasCredentials || usesForbiddenHost) {
    invalidEntries.push(`${packagePath || "<root>"}: ${metadata.resolved}`);
  }
}

if (invalidEntries.length > 0) {
  console.error("package-lock.json contains non-portable resolved URLs:");
  for (const entry of invalidEntries) console.error(`- ${entry}`);
  process.exitCode = 1;
} else {
  console.log("package-lock.json contains only portable resolved URLs.");
}
