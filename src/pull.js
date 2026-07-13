import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import { qmdIndexPath, qmdReleaseTagPath } from "./workspace.js";

const ASSET_NAME = "filoscope.sqlite.gz";
const RELEASE_URL =
  "https://api.github.com/repos/davidgasquez/filoscope/releases/latest";

export async function pullIndex(releaseUrl = RELEASE_URL) {
  const destination = qmdIndexPath();
  const tagPath = qmdReleaseTagPath();
  const release = await latestRelease(releaseUrl);

  if ((await readOptional(tagPath))?.trim() === release.tag && (await exists(destination))) {
    return { destination, tag: release.tag, updated: false };
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });

  const response = await fetch(release.assetUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download prebuilt index (${response.status} ${response.statusText}): ${release.assetUrl}`,
    );
  }

  const staged = `${destination}.tmp`;
  const stagedTag = `${tagPath}.tmp`;
  const stagedFiles = [staged, stagedTag, `${staged}-wal`, `${staged}-shm`];
  try {
    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(staged));
    await validateIndex(staged);
    await Promise.all([`${staged}-wal`, `${staged}-shm`].map((file) => fs.rm(file, { force: true })));
    await fs.writeFile(stagedTag, `${release.tag}\n`);
  } catch (error) {
    await Promise.all(stagedFiles.map((file) => fs.rm(file, { force: true })));
    throw error;
  }

  await Promise.all(
    [`${destination}-wal`, `${destination}-shm`].map((file) => fs.rm(file, { force: true })),
  );
  await fs.rename(staged, destination);
  await fs.rename(stagedTag, tagPath);
  return { destination, tag: release.tag, updated: true };
}

async function latestRelease(url) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "filoscope",
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token && new URL(url).origin === "https://api.github.com") {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to get the latest Filoscope index (${response.status} ${response.statusText}): ${url}`);
  }

  const release = await response.json();
  if (
    !release
    || typeof release !== "object"
    || Array.isArray(release)
    || typeof release.tag_name !== "string"
    || release.tag_name === ""
  ) {
    throw new Error("GitHub latest release response is invalid");
  }
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate.name === ASSET_NAME)
    : undefined;
  if (!asset?.browser_download_url) {
    throw new Error(`Latest release ${release.tag_name} has no ${ASSET_NAME} asset`);
  }

  return { tag: release.tag_name, assetUrl: asset.browser_download_url };
}

async function validateIndex(file) {
  const store = await createStore({ dbPath: file });
  try {
    const status = await store.getStatus();
    if (status.totalDocuments === 0) throw new Error("Downloaded QMD index contains no documents");
    const integrity = store.internal.db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Downloaded QMD index integrity check failed: ${integrity}`);
    const [checkpoint] = store.internal.db.pragma("wal_checkpoint(TRUNCATE)");
    if (checkpoint.busy !== 0) throw new Error("Downloaded QMD index could not be checkpointed");
  } finally {
    await store.close();
  }
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}
