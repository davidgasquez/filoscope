import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { connectorsRoot, materializedRoot, projectRoot } from "./workspace.js";

export async function syncCollections(collections, names) {
  const fullSync = names.length === 0;
  const selected = fullSync
    ? collections
    : collections.filter((collection) => names.includes(collection.name));
  const results = [];

  for (const [index, collection] of selected.entries()) {
    const label = `[${index + 1}/${selected.length}] ${collection.name}`;
    const stagedDestination = await prepareStaging(collection.destination);
    try {
      const files = await materialize(collection, stagedDestination, label);
      await replaceDirectory(stagedDestination, collection.destination);
      results.push({ name: collection.name, files });
    } catch (error) {
      await fs.rm(stagedDestination, { recursive: true, force: true });
      throw error;
    }
  }

  if (fullSync) await removeUndeclaredCollections(collections);
  return results;
}

async function removeUndeclaredCollections(collections) {
  const root = materializedRoot();
  const declared = new Set(collections.map((collection) => collection.name));
  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !declared.has(entry.name))
      .map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true })),
  );
}

async function countFiles(directory) {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

async function materialize(collection, destination, label) {
  const started = performance.now();
  process.stderr.write(`${label} RUN\n`);

  try {
    await fs.mkdir(destination, { recursive: true });
    const connector = await resolveConnector(collection.scheme);
    await runConnector(connector, collection.sourceValue, destination);
    const files = await countFiles(destination);
    if (files === 0) throw new Error("connector wrote 0 files");
    process.stderr.write(`${label} OK ${files} files ${formatDuration(performance.now() - started)}\n`);
    return files;
  } catch (error) {
    process.stderr.write(`${label} FAIL\n`);
    const message = error instanceof Error ? error.message : String(error);
    const syncError = new Error(
      `Failed to sync "${collection.name}" (${collection.source}): ${message}`,
      { cause: error },
    );
    throw syncError;
  }
}

async function resolveConnector(scheme) {
  const connector = path.join(connectorsRoot(), `${scheme}.js`);
  try {
    const stat = await fs.stat(connector);
    if (!stat.isFile()) throw new Error(`Connector is not a file: ${connector}`);
    return connector;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`No connector found for source scheme "${scheme}": ${connector}`);
    }
    throw error;
  }
}

function runConnector(connector, source, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [connector, source, destination], {
      cwd: projectRoot(),
      stdio: ["ignore", process.stderr, process.stderr],
    });

    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`Connector terminated by ${signal}: ${connector}`));
      else if (code === 0) resolve();
      else reject(new Error(`Connector exited with code ${code}: ${connector}`));
    });
  });
}

async function replaceDirectory(staged, destination) {
  const { backup } = scratchPaths(destination);
  const hadDestination = await exists(destination);

  if (hadDestination) await fs.rename(destination, backup);
  try {
    await fs.rename(staged, destination);
  } catch (error) {
    if (hadDestination) {
      try {
        await fs.rename(backup, destination);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Failed to install and restore ${destination}; preserved backup at ${backup}`,
        );
      }
    }
    throw error;
  }

  if (hadDestination) await fs.rm(backup, { recursive: true, force: true });
}

async function recoverDirectory(destination) {
  const { staging, backup } = scratchPaths(destination);
  if (await exists(backup)) {
    if (await exists(destination)) await fs.rm(backup, { recursive: true, force: true });
    else await fs.rename(backup, destination);
  }
  await fs.rm(staging, { recursive: true, force: true });
}

async function prepareStaging(destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await recoverDirectory(destination);
  const { staging } = scratchPaths(destination);
  await fs.mkdir(staging, { recursive: true });
  return staging;
}

function scratchPaths(destination) {
  const parent = path.dirname(destination);
  const basename = path.basename(destination);
  return {
    staging: path.join(parent, `.${basename}.tmp`),
    backup: path.join(parent, `.${basename}.backup`),
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
