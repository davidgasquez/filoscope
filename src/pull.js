import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import { createGunzip } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import YAML from "yaml";
import { qmdConfigPath, qmdIndexPath, qmdReleaseTagPath } from "./workspace.js";

const ASSET_NAME = "filoscope.sqlite.gz";
const RELEASE_URL =
  "https://api.github.com/repos/davidgasquez/filoscope/releases?per_page=100";

export async function pullIndex(releaseUrl = RELEASE_URL) {
  const destination = qmdIndexPath();
  const tagPath = qmdReleaseTagPath();
  const configPath = qmdConfigPath();
  const release = await latestRelease(releaseUrl);

  if ((await readOptional(tagPath))?.trim() === release.tag && (await exists(destination))) {
    try {
      const config = await validateIndex(destination);
      await installConfig(configPath, config);
      return { destination, tag: release.tag, updated: false };
    } catch {
      // Redownload indexes whose stored collection metadata was removed by a missing QMD config.
    }
  }

  await Promise.all([
    fs.mkdir(path.dirname(destination), { recursive: true }),
    fs.mkdir(path.dirname(configPath), { recursive: true }),
  ]);

  const response = await fetch(release.assetUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download prebuilt index (${response.status} ${response.statusText}): ${release.assetUrl}`,
    );
  }

  const staged = `${destination}.tmp`;
  const stagedTag = `${tagPath}.tmp`;
  const stagedConfig = `${configPath}.tmp`;
  const stagedFiles = [staged, stagedTag, stagedConfig, `${staged}-wal`, `${staged}-shm`];
  try {
    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(staged));
    const config = await validateIndex(staged);
    await Promise.all([`${staged}-wal`, `${staged}-shm`].map((file) => fs.rm(file, { force: true })));
    await Promise.all([
      fs.writeFile(stagedTag, `${release.tag}\n`),
      fs.writeFile(stagedConfig, YAML.stringify(config, { indent: 2, lineWidth: 0 })),
    ]);
    await Promise.all(
      [`${destination}-wal`, `${destination}-shm`].map((file) => fs.rm(file, { force: true })),
    );
    await replaceFiles([
      { staged, destination },
      { staged: stagedTag, destination: tagPath },
      { staged: stagedConfig, destination: configPath },
    ]);
  } catch (error) {
    await Promise.all(stagedFiles.map((file) => fs.rm(file, { force: true })));
    throw error;
  }

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

  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error("GitHub releases response is invalid");
  for (const release of releases) {
    if (!release?.tag_name?.startsWith("filoscope-index-")) continue;
    const asset = Array.isArray(release.assets)
      ? release.assets.find((candidate) => candidate.name === ASSET_NAME)
      : undefined;
    if (asset?.browser_download_url) {
      return { tag: release.tag_name, assetUrl: asset.browser_download_url };
    }
  }
  throw new Error(`No published Filoscope index release has a ${ASSET_NAME} asset`);
}

async function validateIndex(file) {
  const store = await createStore({ dbPath: file });
  try {
    const status = await store.getStatus();
    if (status.totalDocuments === 0) throw new Error("Downloaded QMD index contains no documents");
    const collections = await store.listCollections();
    if (collections.length === 0) {
      throw new Error("Downloaded QMD index contains no collection metadata");
    }
    const integrity = store.internal.db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Downloaded QMD index integrity check failed: ${integrity}`);
    const [checkpoint] = store.internal.db.pragma("wal_checkpoint(TRUNCATE)");
    if (checkpoint.busy !== 0) throw new Error("Downloaded QMD index could not be checkpointed");

    const contexts = new Map();
    for (const entry of await store.listContexts()) {
      const collection = contexts.get(entry.collection) ?? {};
      collection[entry.path] = entry.context;
      contexts.set(entry.collection, collection);
    }
    const config = {
      collections: Object.fromEntries(
        collections.map((collection) => [
          collection.name,
          {
            path: collection.pwd,
            pattern: collection.glob_pattern,
            ...(contexts.has(collection.name) ? { context: contexts.get(collection.name) } : {}),
            ...(collection.includeByDefault ? {} : { includeByDefault: false }),
          },
        ]),
      ),
    };
    const globalContext = await store.getGlobalContext();
    if (globalContext !== undefined) config.global_context = globalContext;
    return config;
  } finally {
    await store.close();
  }
}

async function installConfig(destination, config) {
  const current = await readOptional(destination);
  if (current !== undefined) {
    try {
      if (isDeepStrictEqual(YAML.parse(current), config)) return;
    } catch {
      // Replace malformed or stale configuration from the downloaded index.
    }
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staged = `${destination}.tmp`;
  await fs.writeFile(staged, YAML.stringify(config, { indent: 2, lineWidth: 0 }));
  try {
    await replaceFiles([{ staged, destination }]);
  } catch (error) {
    await fs.rm(staged, { force: true });
    throw error;
  }
}

async function replaceFiles(files) {
  const backups = [];
  const installed = [];
  try {
    for (const file of files) {
      const backup = `${file.destination}.backup`;
      await fs.rm(backup, { force: true });
      const hadDestination = await exists(file.destination);
      if (hadDestination) await fs.rename(file.destination, backup);
      backups.push({ backup, destination: file.destination, hadDestination });
    }
    for (const file of files) {
      await fs.rename(file.staged, file.destination);
      installed.push(file.destination);
    }
  } catch (error) {
    await Promise.all(installed.map((file) => fs.rm(file, { force: true })));
    for (const { backup, destination, hadDestination } of backups.reverse()) {
      if (hadDestination && (await exists(backup))) await fs.rename(backup, destination);
    }
    throw error;
  }
  await Promise.all(backups.map(({ backup }) => fs.rm(backup, { force: true })));
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
