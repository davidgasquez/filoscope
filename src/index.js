import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import YAML from "yaml";
import { createStore } from "@tobilu/qmd";

export const INDEX_NAME = "filoscope";
export const DB_FILE = `${INDEX_NAME}.sqlite`;
export const TAG_FILE = `${INDEX_NAME}.release-tag.txt`;
export const ASSET_NAME = `${INDEX_NAME}.sqlite.gz`;
export const DEFAULT_MULTI_GET_MAX_BYTES = 64 * 1024;
export const DEFAULT_RELEASE_API_URL =
  "https://api.github.com/repos/davidgasquez/filoscope/releases/latest";
export const QMD_MODELS = {
  embed: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  generate: "hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf",
  rerank: "hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf",
};

export function collectionPath(name, root = process.cwd()) {
  return resolve(root, ".filoscope", "collections", name);
}

export function collectionRawPath(name, root = process.cwd()) {
  return resolve(root, ".filoscope", "raw", name);
}

export async function syncCollections(names = [], options = {}) {
  const root = options.root ?? process.cwd();
  const collections = await loadCollections(names, { root });
  if (collections.length === 0) throw new Error("No collections matched.");

  for (const collection of collections) {
    const out = collectionPath(collection.name, root);
    const raw = collectionRawPath(collection.name, root);
    options.stderr?.write?.(`\n==> ${collection.name}\n`) ?? process.stderr.write(`\n==> ${collection.name}\n`);
    await mkdir(dirname(out), { recursive: true });
    await mkdir(raw, { recursive: true });
    await runShell(collection.sync, {
      cwd: root,
      env: {
        COLLECTION_NAME: collection.name,
        COLLECTION_PATH: out,
        COLLECTION_RAW: raw,
        COLLECTION_OUT: out,
        RAW: raw,
        OUT: out,
        FILOSCOPE_ROOT: root,
        PATH: scriptPath(root),
      },
    });
  }
}

export async function loadCollections(names = [], options = {}) {
  const root = options.root ?? process.cwd();
  const dir = resolve(root, "collections");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml")).sort();
  const wanted = new Set(names);
  const collections = [];

  for (const file of files) {
    const config = YAML.parse(await readFile(join(dir, file), "utf8"));
    validateCollection(config, file);
    if (wanted.size === 0 || wanted.has(config.name)) collections.push(config);
  }

  const missing = [...wanted].filter((name) => !collections.some((collection) => collection.name === name));
  if (missing.length > 0) throw new Error(`Unknown collection(s): ${missing.join(", ")}`);
  return collections;
}

export function validateCollection(collection, file = "collection") {
  for (const key of ["name", "context", "sync"]) {
    if (typeof collection?.[key] !== "string" || collection[key].trim() === "") {
      throw new Error(`${file}: missing string field '${key}'`);
    }
  }
  if (!Array.isArray(collection.include) || collection.include.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${file}: 'include' must be a non-empty string list`);
  }
}

export async function writeQmdConfig(collections, options = {}) {
  const root = options.root ?? process.cwd();
  const config = {
    collections: Object.fromEntries(collections.map((collection) => [
      collection.name,
      {
        path: collectionPath(collection.name, root),
        pattern: qmdPattern(collection.include),
        context: { "/": collection.context },
      },
    ])),
    models: QMD_MODELS,
  };

  const path = qmdConfigPathLocal(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, YAML.stringify(config, { lineWidth: 0 }), "utf8");
  options.stderr?.write?.(`Wrote ${path}\n`) ?? process.stderr.write(`Wrote ${path}\n`);
  return path;
}

export async function listCollectionDefinitions(options = {}) {
  const root = options.root ?? process.cwd();
  return (await loadCollections([], { root })).map((collection) => ({
    name: collection.name,
    path: collectionPath(collection.name, root),
  }));
}

export function qmdPattern(include) {
  return include.length === 1 ? include[0] : `{${include.join(",")}}`;
}

export async function runShell(script, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn("bash", ["-euo", "pipefail", "-c", script], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else if (code === 0) resolvePromise();
      else reject(new Error(`sync command failed with exit code ${code}`));
    });
  });
}

export async function ensureIndex({ force = false } = {}) {
  const paths = cachePaths();
  const hasCachedDb = await exists(paths.dbPath);
  let release;

  try {
    release = await latestRelease();
  } catch (error) {
    if (force || !hasCachedDb) throw error;
    console.error(`Warning: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Using cached index at ${paths.dbPath}`);
    await ensurePublishedQmdConfig(paths.dbPath, false);
    return;
  }

  if (!force && hasCachedDb) {
    const currentTag = (await readOptional(paths.tagPath))?.trim();
    if (currentTag === release.tag) {
      await ensurePublishedQmdConfig(paths.dbPath, false);
      return;
    }
  }

  await mkdir(paths.cacheDir, { recursive: true });
  const tempDir = await mkdtemp(join(paths.cacheDir, ".filoscope-"));
  const gzPath = join(tempDir, `${DB_FILE}.gz`);
  const sqlitePath = join(tempDir, DB_FILE);

  try {
    const response = await fetch(release.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

    await pipeline(response.body, createWriteStream(gzPath));
    await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(sqlitePath));
    await verifySqlite(sqlitePath);
    await rename(sqlitePath, paths.dbPath);
    await writeFile(paths.tagPath, `${release.tag}\n`, "utf8");
    await ensurePublishedQmdConfig(paths.dbPath, true);
    console.error(`Cached ${paths.dbPath}`);
  } catch (error) {
    if (force || !hasCachedDb) throw error;
    console.error(`Warning: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Using cached index at ${paths.dbPath}`);
    await ensurePublishedQmdConfig(paths.dbPath, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function latestRelease() {
  const overrideUrl = process.env.FILOSCOPE_INDEX_URL;
  if (overrideUrl) return { tag: String(overrideUrl), url: String(overrideUrl) };

  const response = await fetch(DEFAULT_RELEASE_API_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": INDEX_NAME },
  });
  if (!response.ok) throw new Error(`Latest release lookup failed: ${response.status} ${response.statusText}`);

  const release = await response.json();
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item.name === ASSET_NAME)
    : undefined;

  if (!release.tag_name) throw new Error("Latest release response missing tag_name");
  if (!asset?.browser_download_url) throw new Error(`Latest release missing asset: ${ASSET_NAME}`);
  return { tag: String(release.tag_name), url: String(asset.browser_download_url) };
}

export async function ensurePublishedQmdConfig(dbPath, overwrite) {
  const configPath = qmdConfigPathPublished();
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
    await writeFile(configPath, YAML.stringify(config, { lineWidth: 0 }), "utf8");
  } finally {
    await store.close();
  }
}

export async function verifySqlite(dbPath) {
  const store = await createStore({ dbPath });
  try {
    const row = store.internal.db.prepare("PRAGMA integrity_check").get();
    if (row?.integrity_check !== "ok") throw new Error(`SQLite integrity_check failed: ${row?.integrity_check}`);
  } finally {
    await store.close();
  }
}

export async function runQmd(args, { local }) {
  const qmdArgs = local ? [qmdBinPath(), ...args] : [qmdBinPath(), "--index", INDEX_NAME, ...args];
  const env = local ? process.env : { ...process.env, INDEX_PATH: cachePaths().dbPath };

  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, qmdArgs, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else if (code === 0) resolvePromise();
      else {
        process.exitCode = code ?? 1;
        reject(new Error(`qmd exited with code ${code}`));
      }
    });
  });
}

export function qmdBinPath() {
  const qmdEntry = fileURLToPath(import.meta.resolve("@tobilu/qmd"));
  return resolve(dirname(qmdEntry), "..", "bin", "qmd");
}

export function scriptPath(root = process.cwd()) {
  const localCollectors = resolve(root, "scripts", "collectors");
  const localNormalizers = resolve(root, "scripts", "normalizers");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const packageCollectors = resolve(packageRoot, "scripts", "collectors");
  const packageNormalizers = resolve(packageRoot, "scripts", "normalizers");
  return [localCollectors, localNormalizers, packageCollectors, packageNormalizers, process.env.PATH ?? ""].join(delimiter);
}

export function forwardArgs(args) {
  if (args[0] !== "multi-get" || hasOption(args, "--max-bytes")) return args;
  return [...args, "--max-bytes", String(DEFAULT_MULTI_GET_MAX_BYTES)];
}

export function hasOption(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

export function cachePaths() {
  const cacheDir = resolve(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "qmd");
  return { cacheDir, dbPath: join(cacheDir, DB_FILE), tagPath: join(cacheDir, TAG_FILE) };
}

export function qmdConfigPathPublished() {
  const configDir = process.env.QMD_CONFIG_DIR
    ? resolve(process.env.QMD_CONFIG_DIR)
    : resolve(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "qmd");
  return join(configDir, `${INDEX_NAME}.yml`);
}

export function qmdConfigPathLocal(root = process.cwd()) {
  return resolve(root, ".qmd", "index.yml");
}

export function qmdDbPathLocal(root = process.cwd()) {
  return resolve(root, ".qmd", "index.sqlite");
}

export async function isLocalProject(root = process.cwd()) {
  const manifest = await readOptional(resolve(root, "package.json"));
  if (!manifest) return false;

  let packageJson;
  try {
    packageJson = JSON.parse(manifest);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }

  if (packageJson.name !== INDEX_NAME) return false;

  try {
    const files = await readdir(resolve(root, "collections"));
    return files.some((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function isMetadataCommand(args) {
  return args.length === 0 || args.includes("--help") || args.includes("-h") || args.includes("--version") || args.includes("-v") || args[0] === "help";
}

export function cleanObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function parseJsonField(value) {
  if (!value) return undefined;
  return JSON.parse(value);
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
