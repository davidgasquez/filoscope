#!/usr/bin/env node

import {
  ensureIndex,
  exists,
  forwardArgs,
  isLocalProject,
  isMetadataCommand,
  listCollectionDefinitions,
  loadCollections,
  qmdConfigPathLocal,
  runQmd,
  syncCollections,
  writeQmdConfig,
} from "./index.js";

const USAGE = `filoscope — A Filecoin knowledge base built for your agents

Usage:
  filoscope <command> [options]
  filoscope --refresh-index

Local knowledge-base commands:
  filoscope sync [collection...]      Sync sources, update QMD, and embed
  filoscope qmd-config                Generate .qmd/index.yml from collections/*.yml
  filoscope index [collection...]     Sync, generate QMD config, update, and embed
  filoscope collections               List local collection definitions

Search commands:
  filoscope query <query>             Hybrid search with expansion + reranking
  filoscope search <query>            Full-text keyword search
  filoscope vsearch <query>           Vector similarity search
  filoscope get <file>[:from[:count]] Show a document or line range
  filoscope multi-get <pattern>       Batch fetch by glob or comma-separated list
  filoscope ls [collection[/path]]    Inspect indexed files
  filoscope status                    Show index and collection health

Query examples:
  filoscope query "how does Filecoin storage power work"
  filoscope search '"FIP-0081"' -c fips -n 5
  filoscope get '#4cb064:1:40'

Index options:
  --refresh-index                     Re-download the published Filecoin index
  pull-index                          Re-download the published Filecoin index and exit

The published index downloads automatically outside a local Filoscope repo.
Inside a repo with collections/*.yml, search commands use the local .qmd index.
`;

async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || ["-h", "--help", "help"].includes(args[0])) {
    console.log(USAGE.trimEnd());
    return;
  }

  const command = args[0];
  const rest = args.slice(1);

  if (command === "sync") {
    await syncAndIndex(rest);
    return;
  }

  if (["qmd-config", "generate-qmd"].includes(command)) {
    await writeQmdConfig(await loadCollections());
    return;
  }

  if (command === "collections") {
    for (const collection of await listCollectionDefinitions()) {
      console.log(`${collection.name}\t${collection.path}`);
    }
    return;
  }

  if (command === "index") {
    await syncAndIndex(rest);
    return;
  }

  if (command === "mcp") {
    throw new Error("filoscope mcp is not supported; use the CLI commands instead.");
  }

  const parsed = parseWrapperArgs(args);
  if (parsed.refreshOnly || (parsed.force && parsed.forwardArgs.length === 0)) {
    await ensureIndex({ force: true });
    return;
  }

  if (await isLocalProject()) {
    if (!(await exists(qmdConfigPathLocal()))) await writeQmdConfig(await loadCollections());
    await runQmd(forwardArgs(parsed.forwardArgs), { local: true });
    return;
  }

  if (!isMetadataCommand(parsed.forwardArgs) || parsed.force) {
    await ensureIndex({ force: parsed.force });
  }
  await runQmd(forwardArgs(parsed.forwardArgs), { local: false });
}

async function syncAndIndex(collectionNames) {
  await syncCollections(collectionNames);
  await writeQmdConfig(await loadCollections());
  await runQmd(["update"], { local: true });
  await runQmd(["embed", "--chunk-strategy", "auto"], { local: true });
  await runQmd(["cleanup"], { local: true });
}

function parseWrapperArgs(args) {
  const forwardArgs = [];
  let force = false;
  let refreshOnly = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--refresh-index") {
      force = true;
    } else if (arg === "pull-index") {
      refreshOnly = true;
    } else if (arg === "--index") {
      index++;
    } else if (!arg.startsWith("--index=")) {
      forwardArgs.push(arg);
    }
  }

  return { force, forwardArgs, refreshOnly };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
