#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { createStore } from "@tobilu/qmd";

const INDEX_NAME = "filoscope";
const DB_FILE = `${INDEX_NAME}.sqlite`;
const TAG_FILE = `${INDEX_NAME}.release-tag.txt`;
const ASSET_NAME = `${INDEX_NAME}.sqlite.gz`;
const DEFAULT_MULTI_GET_MAX_BYTES = 64 * 1024;
const DEFAULT_RELEASE_API_URL =
  "https://api.github.com/repos/davidgasquez/filoscope/releases/latest";

const USAGE = `filoscope — A Filecoin knowledge base built for your agents

Usage:
  filoscope <command> [options]
  filoscope --refresh-index

Primary commands:
  filoscope query <query>             Hybrid search with expansion + reranking
  filoscope search <query>            Full-text keyword search
  filoscope vsearch <query>           Vector similarity search
  filoscope get <file>[:from[:count]] Show a document or line range
  filoscope multi-get <pattern>       Batch fetch by glob or comma-separated list
  filoscope ls [collection[/path]]    Inspect indexed files
  filoscope status                    Show index and collection health

Query examples:
  filoscope query "how does Filecoin storage power work"
  filoscope query $'lex: FIP-0081\\nvec: verifiable deal proposal lifecycle'
  filoscope search '"daily_network_activity_by_method"' -c fdp -n 10
  filoscope get '#4cb064:1:40'
  filoscope multi-get 'fips/FIPS/*.md' -l 80 --format md

Query syntax:
  Single-line queries are expanded automatically.
  Multi-line query documents can combine typed search lines:
    intent: optional background context
    lex:    exact keywords, quoted phrases, and -negation
    vec:    semantic natural language search
    hyde:   hypothetical answer text for semantic search

Search options:
  -n <num>                   Max results
  -c, --collection <name>    Filter by collection; can be repeated
  --format <kind>            cli, json, csv, md, xml, or files
  --min-score <num>          Minimum similarity score
  --full                     Output full documents instead of snippets
  --all                      Return all matches
  --no-rerank                Skip reranking for faster queries
  --no-gpu                   Force CPU mode
  --line-numbers             Include line numbers in search output
  --no-line-numbers          Disable line numbers for get/multi-get
  --full-path                Show on-disk paths instead of qmd:// paths

Multi-get options:
  -l <num>                   Maximum lines per file
  --max-bytes <num>          Skip files larger than N bytes

Index options:
  --refresh-index            Re-download the Filecoin index before running
  pull-index                 Re-download the Filecoin index and exit

Cache:
  ${cachePaths().dbPath}
  ${qmdConfigPath()}

The index is downloaded automatically the first time it is needed.
`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseWrapperArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(USAGE.trimEnd());
    return;
  }

  if (parsed.forwardArgs[0] === "mcp") {
    throw new Error("filoscope mcp is not supported; use the CLI commands instead.");
  }

  if (parsed.refreshOnly || (parsed.force && parsed.forwardArgs.length === 0)) {
    await ensureIndex({ force: true });
    return;
  }

  if (!isMetadataCommand(parsed.forwardArgs) || parsed.force) {
    await ensureIndex({ force: parsed.force });
  }

  await runQmd(parsed.forwardArgs);
}

function parseWrapperArgs(args) {
  const forwardArgs = [];
  let force = false;
  let help = args.length === 0;
  let refreshOnly = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--refresh-index") {
      force = true;
      continue;
    }

    if (arg === "pull-index") {
      refreshOnly = true;
      continue;
    }

    if (arg === "--index") {
      index++;
      continue;
    }

    if (arg.startsWith("--index=")) continue;

    if (args.length === 1 && ["-h", "--help", "help"].includes(arg)) {
      help = true;
      continue;
    }

    forwardArgs.push(arg);
  }

  return { force, forwardArgs, help, refreshOnly };
}

async function ensureIndex({ force = false } = {}) {
  const paths = cachePaths();
  const hasCachedDb = await exists(paths.dbPath);
  let release;

  try {
    release = await latestRelease();
  } catch (error) {
    if (force || !hasCachedDb) throw error;
    console.error(`Warning: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Using cached index at ${paths.dbPath}`);
    await ensureQmdConfig(paths.dbPath, false);
    return;
  }

  if (!force && hasCachedDb) {
    const currentTag = (await readOptional(paths.tagPath))?.trim();
    if (currentTag === release.tag) {
      await ensureQmdConfig(paths.dbPath, false);
      return;
    }
  }

  await mkdir(paths.cacheDir, { recursive: true });

  const tempDir = await mkdtemp(join(paths.cacheDir, ".filoscope-"));
  const gzPath = join(tempDir, `${DB_FILE}.gz`);
  const sqlitePath = join(tempDir, DB_FILE);

  try {
    const response = await fetch(release.url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    await pipeline(response.body, createWriteStream(gzPath));
    await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(sqlitePath));
    await verifySqlite(sqlitePath);
    await rename(sqlitePath, paths.dbPath);
    await writeFile(paths.tagPath, `${release.tag}\n`, "utf8");
    await ensureQmdConfig(paths.dbPath, true);

    console.error(`Cached ${paths.dbPath}`);
  } catch (error) {
    if (force || !hasCachedDb) throw error;
    console.error(`Warning: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Using cached index at ${paths.dbPath}`);
    await ensureQmdConfig(paths.dbPath, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function latestRelease() {
  const overrideUrl = process.env.FILOSCOPE_INDEX_URL;
  if (overrideUrl) return { tag: String(overrideUrl), url: String(overrideUrl) };

  const response = await fetch(DEFAULT_RELEASE_API_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": INDEX_NAME,
    },
  });
  if (!response.ok) {
    throw new Error(`Latest release lookup failed: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === ASSET_NAME)
    : undefined;

  if (!release.tag_name) throw new Error("Latest release response missing tag_name");
  if (!asset?.browser_download_url) throw new Error(`Latest release missing asset: ${ASSET_NAME}`);

  return { tag: String(release.tag_name), url: String(asset.browser_download_url) };
}

async function ensureQmdConfig(dbPath, overwrite) {
  const configPath = qmdConfigPath();
  if (!overwrite && await exists(configPath)) return;

  const store = await createStore({ dbPath });
  try {
    const rows = store.internal.db.prepare(`
      SELECT name, path, pattern, ignore_patterns, include_by_default, update_command, context
      FROM store_collections
      ORDER BY name
    `).all();
    if (rows.length === 0) return;

    const config = { collections: {} };
    for (const row of rows) {
      config.collections[row.name] = cleanObject({
        path: row.path,
        pattern: row.pattern,
        ignore: parseJsonField(row.ignore_patterns),
        includeByDefault: row.include_by_default === 0 ? false : undefined,
        update: row.update_command || undefined,
        context: parseJsonField(row.context),
      });
    }

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } finally {
    await store.close();
  }
}

async function verifySqlite(dbPath) {
  const store = await createStore({ dbPath });
  try {
    const row = store.internal.db.prepare("PRAGMA integrity_check").get();
    const result = row?.integrity_check;
    if (result !== "ok") throw new Error(`SQLite integrity_check failed: ${result}`);
  } finally {
    await store.close();
  }
}

async function runQmd(args) {
  const qmdBin = qmdBinPath();
  const qmdArgs = [qmdBin, "--index", INDEX_NAME, ...forwardArgs(args)];
  const env = qmdEnv();

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, qmdArgs, { env, stdio: "inherit" });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exitCode = code ?? 0;
        resolvePromise();
      }
    });

    child.on("error", reject);
  });
}

function qmdBinPath() {
  const qmdEntry = fileURLToPath(import.meta.resolve("@tobilu/qmd"));
  return resolve(dirname(qmdEntry), "..", "bin", "qmd");
}

function forwardArgs(args) {
  if (args[0] !== "multi-get" || hasOption(args, "--max-bytes")) return args;
  return [...args, "--max-bytes", String(DEFAULT_MULTI_GET_MAX_BYTES)];
}

function hasOption(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function cachePaths() {
  const cacheDir = resolve(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "qmd");
  return {
    cacheDir,
    dbPath: join(cacheDir, DB_FILE),
    tagPath: join(cacheDir, TAG_FILE),
  };
}

function qmdConfigPath() {
  const configDir = process.env.QMD_CONFIG_DIR
    ? resolve(process.env.QMD_CONFIG_DIR)
    : resolve(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "qmd");
  return join(configDir, `${INDEX_NAME}.yml`);
}

function isMetadataCommand(args) {
  return args.length === 0
    || args.includes("--help")
    || args.includes("-h")
    || args.includes("--version")
    || args.includes("-v")
    || args[0] === "help";
}

function qmdEnv() {
  return {
    ...process.env,
    INDEX_PATH: cachePaths().dbPath,
  };
}

function cleanObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function parseJsonField(value) {
  if (!value) return undefined;
  return JSON.parse(value);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
