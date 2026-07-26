import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { openTestDatabase } from "../dist/database.js";

export async function temporaryDatabase(prefix = "database-") {
  const parent = path.join(process.cwd(), "temp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, prefix));
  const file = path.join(directory, "broker.db");
  const database = await openTestDatabase(file);
  return {
    database,
    file,
    directory,
    async cleanup() {
      await database.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
