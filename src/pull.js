import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { qmdIndexPath } from "./workspace.js";

const INDEX_URL =
  "https://github.com/davidgasquez/filoscope/releases/download/latest-index/filoscope.sqlite.gz";

export async function pullIndex(url = INDEX_URL) {
  const destination = qmdIndexPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download prebuilt index (${response.status} ${response.statusText}): ${url}`);
  }

  const staged = `${destination}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(staged));
  } catch (error) {
    await fs.rm(staged, { force: true });
    throw error;
  }

  await Promise.all(
    [`${destination}-wal`, `${destination}-shm`].map((file) => fs.rm(file, { force: true })),
  );
  await fs.rename(staged, destination);
  return destination;
}
