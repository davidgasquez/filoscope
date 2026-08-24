import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Collection } from "./types.ts";

export type SyncResult = { name: string; files: number };

export async function syncCollections(
  collections: readonly Collection[],
  names: readonly string[],
  outputRoot: string,
): Promise<SyncResult[]> {
  const known = new Set(collections.map((collection) => collection.name));
  const unknown = names.find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown collection: ${unknown}`);

  const fullSync = names.length === 0;
  const selected = fullSync
    ? collections
    : collections.filter((collection) => names.includes(collection.name));
  const results: SyncResult[] = [];

  for (const [index, collection] of selected.entries()) {
    const destination = path.join(outputRoot, collection.name);
    const staging = await prepareStaging(destination);
    const label = `[${index + 1}/${selected.length}] ${collection.name}`;
    const started = performance.now();
    process.stderr.write(`${label} RUN\n`);

    try {
      await collection.materialize(staging);
      const files = await countFiles(staging);
      if (files === 0) throw new Error("collection materialized 0 files");
      await replaceDirectory(staging, destination);
      process.stderr.write(
        `${label} OK ${files} files ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
      );
      results.push({ name: collection.name, files });
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      process.stderr.write(`${label} FAIL\n`);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to sync "${collection.name}": ${message}`, { cause: error });
    }
  }

  if (fullSync) await removeUndeclared(outputRoot, known);
  return results;
}

async function countFiles(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

async function prepareStaging(destination: string): Promise<string> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const { staging, backup } = scratchPaths(destination);
  if (await exists(backup)) {
    if (await exists(destination)) await fs.rm(backup, { recursive: true, force: true });
    else await fs.rename(backup, destination);
  }
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  return staging;
}

async function replaceDirectory(staging: string, destination: string): Promise<void> {
  const { backup } = scratchPaths(destination);
  const hadDestination = await exists(destination);
  if (hadDestination) await fs.rename(destination, backup);
  try {
    await fs.rename(staging, destination);
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

async function removeUndeclared(root: string, declared: Set<string>): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !declared.has(entry.name))
      .map((entry) => fs.rm(path.join(root, entry.name), { recursive: true, force: true })),
  );
}

function scratchPaths(destination: string): { staging: string; backup: string } {
  const parent = path.dirname(destination);
  const name = path.basename(destination);
  return {
    staging: path.join(parent, `.${name}.tmp`),
    backup: path.join(parent, `.${name}.backup`),
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
