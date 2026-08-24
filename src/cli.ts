#!/usr/bin/env node
import { loadAreas, loadCollections } from "./config.ts";
import { writeQmdConfig } from "./qmd/config.ts";
import { syncCollections } from "./sync.ts";
import { requireWorkspace, resolveCatalog } from "./workspace.ts";
import type { Area, Collection } from "./types.ts";
import type { Workspace } from "./workspace.ts";

const usage = `Filoscope

Usage:
  filoscope sync [collection-name ...]
  filoscope config
  filoscope pull
  filoscope publish
  filoscope areas
  filoscope area <area-name>
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(usage.trim());
      return;
    case "sync":
      await sync(args);
      return;
    case "config":
      if (args.length > 0) throw new Error("Usage: filoscope config");
      await config();
      return;
    case "pull":
      if (args.length > 0) throw new Error("Usage: filoscope pull");
      await pull();
      return;
    case "publish":
      if (args.length > 0) throw new Error("Usage: filoscope publish");
      await publish();
      return;
    case "areas":
      if (args.length > 0) throw new Error("Usage: filoscope areas");
      await listAreas();
      return;
    case "area":
      if (args.length !== 1) throw new Error("Usage: filoscope area <area-name>");
      await selectArea(args[0]!);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage.trim()}`);
  }
}

async function sync(names: string[]): Promise<void> {
  const { workspace, collections } = await loadWorkspace();
  const results = await syncCollections(collections, names, workspace.materializedDirectory);
  for (const result of results) console.log(`${result.name}: ${result.files} files`);
}

async function config(): Promise<void> {
  const { workspace, collections } = await loadWorkspace();
  const destination = await writeQmdConfig(collections, workspace.materializedDirectory);
  console.log(`Generated ${destination}`);
}

async function pull(): Promise<void> {
  const { pullIndex } = await import("./qmd/pull.ts");
  const result = await pullIndex();
  console.log(
    result.updated
      ? `Downloaded ${result.tag} to ${result.destination}`
      : `Already up to date with ${result.tag} at ${result.destination}`,
  );
}

async function publish(): Promise<void> {
  const { publishWorkspace } = await import("./qmd/publish.ts");
  await publishWorkspace(requireWorkspace());
}

async function listAreas(): Promise<void> {
  const areas = await catalogAreas();
  for (const area of areas) console.log(`${area.name}\t${area.description}`);
}

async function selectArea(name: string): Promise<void> {
  const areas = await catalogAreas();
  const area = areas.find((candidate) => candidate.name === name);
  if (!area) throw new Error(`Unknown area: ${name}`);
  console.log(area.collections.flatMap((collection) => ["-c", collection]).join(" "));
}

async function loadWorkspace(): Promise<{ workspace: Workspace; collections: Collection[] }> {
  const workspace = requireWorkspace();
  const collections = await loadCollections(workspace.collectionsDirectory);
  return { workspace, collections };
}

async function catalogAreas(): Promise<Area[]> {
  const catalog = resolveCatalog();
  const collections = await loadCollections(catalog.collectionsDirectory);
  return await loadAreas(catalog.areasDirectory, collections);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
