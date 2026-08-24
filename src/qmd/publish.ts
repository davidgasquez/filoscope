import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createStore } from "@tobilu/qmd";
import { loadCollections } from "../config.ts";
import { syncCollections } from "../sync.ts";
import type { Workspace } from "../workspace.ts";
import { writeQmdConfig } from "./config.ts";
import { validateSqliteDatabase } from "./database.ts";
import {
  QMD_INDEX_ASSET,
  QMD_INDEX_NAME,
  QMD_RELEASE_PREFIX,
  qmdIndexPath,
  qmdReleaseTagPath,
} from "./paths.ts";

const MAX_EMBED_ATTEMPTS = 8;
const EMBED_TIMEOUT_MINUTES = 300;
const qmd = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve("@tobilu/qmd"))),
  "..",
  "bin",
  "qmd",
);

export async function publishWorkspace(workspace: Workspace): Promise<string> {
  const target = await preparePublish(workspace.root);
  const collections = await loadCollections(workspace.collectionsDirectory);
  await syncCollections(collections, [], workspace.materializedDirectory);
  await writeQmdConfig(collections, workspace.materializedDirectory);
  await fs.rm(qmdReleaseTagPath(), { force: true });
  await runQmd(workspace.root, "update");
  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
    const pending = await pendingEmbeddings();
    if (pending === 0) break;
    console.log(`Embedding attempt ${attempt}: ${pending} documents pending`);
    await runQmd(
      workspace.root,
      "embed",
      "--chunk-strategy",
      "auto",
      "--timeout",
      String(EMBED_TIMEOUT_MINUTES),
    );
  }
  await runQmd(workspace.root, "cleanup");
  await validateIndex();

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-publish-"));
  const artifact = path.join(temporary, QMD_INDEX_ASSET);
  const tag = releaseTag();
  try {
    await pipeline(createReadStream(qmdIndexPath()), createGzip(), createWriteStream(artifact));
    await run(
      "gh",
      [
        "release",
        "create",
        tag,
        artifact,
        "--title",
        tag,
        "--notes",
        `Filoscope index built from ${target}.`,
        "--target",
        target,
        "--latest",
      ],
      workspace.root,
    );
    await fs.writeFile(qmdReleaseTagPath(), `${tag}\n`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  console.log(`Published ${tag}`);
  return tag;
}

async function preparePublish(root: string): Promise<string> {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error(
      'filoscope publish requires GH_TOKEN or GITHUB_TOKEN (for example: export GH_TOKEN="$(gh auth token)")',
    );
  }
  const status = await capture("git", ["status", "--porcelain", "--untracked-files=normal"], root);
  if (status.trim()) throw new Error("filoscope publish requires a clean Git worktree");
  const target = (await capture("git", ["rev-parse", "HEAD"], root)).trim();
  await run("gh", ["api", `repos/{owner}/{repo}/commits/${target}`, "--silent"], root);
  return target;
}

function releaseTag(): string {
  const datetime = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${QMD_RELEASE_PREFIX}${datetime}`;
}

async function runQmd(root: string, ...args: string[]): Promise<void> {
  const timeout = args[0] === "embed" ? (EMBED_TIMEOUT_MINUTES + 1) * 60_000 : undefined;
  await run(process.execPath, [qmd, "--index", QMD_INDEX_NAME, ...args], root, timeout);
}

async function pendingEmbeddings(): Promise<number> {
  const store = await createStore({ dbPath: qmdIndexPath() });
  try {
    return (await store.getStatus()).needsEmbedding;
  } finally {
    await store.close();
  }
}

async function validateIndex(): Promise<void> {
  const store = await createStore({ dbPath: qmdIndexPath() });
  try {
    const status = await store.getStatus();
    if (status.totalDocuments === 0) throw new Error("QMD index contains no documents");
    if (status.needsEmbedding > 0) {
      throw new Error(`${status.needsEmbedding} documents still need embeddings`);
    }
    if (!status.hasVectorIndex) throw new Error("QMD index has no vector index");
    if ((await store.searchLex("Filecoin", { limit: 1 })).length === 0) {
      throw new Error("QMD index search returned no results");
    }

    validateSqliteDatabase(store.internal.db, "QMD index");
  } finally {
    await store.close();
  }
}

function capture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeout?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
      timeout,
    });
    child.once("error", (error) => {
      reject(new Error(`Failed to run ${command}: ${error.message}`, { cause: error }));
    });
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
