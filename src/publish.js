import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createStore } from "@tobilu/qmd";
import { projectRoot, QMD_INDEX_NAME, qmdIndexPath, qmdReleaseTagPath } from "./workspace.js";

const MAX_EMBED_ATTEMPTS = 8;
const EMBED_TIMEOUT_MINUTES = 300;
const execFileAsync = promisify(execFile);
const qmd = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve("@tobilu/qmd"))),
  "..",
  "bin",
  "qmd",
);

export async function preparePublish() {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error(
      'filoscope publish requires GH_TOKEN or GITHUB_TOKEN (for example: export GH_TOKEN="$(gh auth token)")',
    );
  }
  const gitOptions = {
    cwd: projectRoot(),
    encoding: "utf8",
  };
  const { stdout: status } = await execFileAsync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    gitOptions,
  );
  if (status.trim()) {
    throw new Error("filoscope publish requires a clean Git worktree");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], gitOptions);
  const target = stdout.trim();
  await run("gh", ["api", `repos/{owner}/{repo}/commits/${target}`, "--silent"]);
  return target;
}

export async function publishIndex(target) {
  await fs.rm(qmdReleaseTagPath(), { force: true });
  await runQmd("update");

  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
    const pending = await pendingEmbeddings();
    if (pending === 0) break;
    console.log(`Embedding attempt ${attempt}: ${pending} documents pending`);
    await runQmd(
      "embed",
      "--chunk-strategy",
      "auto",
      "--timeout",
      String(EMBED_TIMEOUT_MINUTES),
    );
  }

  await runQmd("cleanup");
  await validateIndex();

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-publish-"));
  const artifact = path.join(temporary, "filoscope.sqlite.gz");
  let tag;
  try {
    await pipeline(createReadStream(qmdIndexPath()), createGzip(), createWriteStream(artifact));
    tag = releaseTag();
    await run("gh", [
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
    ]);
    await fs.writeFile(qmdReleaseTagPath(), `${tag}\n`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }

  console.log(`Published ${tag}`);
  return tag;
}

function releaseTag() {
  const datetime = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `filoscope-index-${datetime}`;
}

async function runQmd(...args) {
  const timeout = args[0] === "embed" ? (EMBED_TIMEOUT_MINUTES + 1) * 60_000 : undefined;
  await run(process.execPath, [qmd, "--index", QMD_INDEX_NAME, ...args], { timeout });
}

async function pendingEmbeddings() {
  const store = await createStore({ dbPath: qmdIndexPath() });
  try {
    return (await store.getStatus()).needsEmbedding;
  } finally {
    await store.close();
  }
}

async function validateIndex() {
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

    const [checkpoint] = store.internal.db.pragma("wal_checkpoint(TRUNCATE)");
    if (checkpoint.busy !== 0) throw new Error("QMD index is busy and could not be checkpointed");
    const integrity = store.internal.db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`QMD index integrity check failed: ${integrity}`);
  } finally {
    await store.close();
  }
}

function run(command, args, { stdout = "inherit", timeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot(),
      stdio: ["ignore", stdout, "inherit"],
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
