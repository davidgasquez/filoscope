#!/usr/bin/env node
import { loadAreas } from "./areas.js";
import { loadCollections, writeQmdConfig } from "./config.js";
import { pullIndex } from "./pull.js";
import { syncCollections } from "./sync.js";

const usage = `Filoscope

Usage:
  filoscope sync [collection-name ...]
  filoscope config
  filoscope pull
  filoscope publish
  filoscope areas
  filoscope area <area-name>
`;

async function main(argv) {
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
      const { preparePublish, publishIndex } = await import("./publish.js");
      const target = await preparePublish();
      await sync([]);
      await publishIndex(target);
      return;
    case "areas":
      if (args.length > 0) throw new Error("Usage: filoscope areas");
      await listAreas();
      return;
    case "area":
      if (args.length !== 1) throw new Error("Usage: filoscope area <area-name>");
      await selectArea(args[0]);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage.trim()}`);
  }
}

async function pull() {
  const result = await pullIndex();
  console.log(
    result.updated
      ? `Downloaded ${result.tag} to ${result.destination}`
      : `Already up to date with ${result.tag} at ${result.destination}`,
  );
}

async function sync(names) {
  const collections = await loadCollections();
  const known = new Set(collections.map((collection) => collection.name));
  const unknown = names.find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown collection: ${unknown}`);
  const results = await syncCollections(collections, names);
  const configPath = await writeQmdConfig(collections);

  for (const result of results) {
    console.log(`${result.name}: ${result.files} files`);
  }
  console.log(`Generated ${configPath}`);
}

async function config() {
  const collections = await loadCollections();
  const configPath = await writeQmdConfig(collections);
  console.log(`Generated ${configPath}`);
}

async function listAreas() {
  const areas = await loadAreas();
  for (const area of areas) console.log(`${area.name}\t${area.description}`);
}

async function selectArea(name) {
  const areas = await loadAreas();
  const area = areas.find((candidate) => candidate.name === name);
  if (!area) throw new Error(`Unknown area: ${name}`);
  console.log(area.collections.flatMap((collection) => ["-c", collection]).join(" "));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
