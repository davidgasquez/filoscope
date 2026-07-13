import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import YAML from "yaml";
import { pullIndex } from "../src/pull.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "src", "cli.js");
const qmd = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve("@tobilu/qmd"))),
  "..",
  "bin",
  "qmd",
);

const materializingConnector = `
import fs from "node:fs/promises";
import path from "node:path";
const [source, destination] = process.argv.slice(2);
await fs.writeFile(path.join(destination, \`${"${source}"}.md\`), source);
`;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-test-"));
  await fs.mkdir(path.join(root, "collections"));
  await fs.mkdir(path.join(root, "connectors"));
  return root;
}

function xdgEnv(root, overrides = {}) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
    XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
    ...overrides,
  };
}

function qmdConfigFile(root) {
  return path.join(root, "xdg", "config", "qmd", "filoscope.yml");
}

async function runCli(root, ...args) {
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: xdgEnv(root),
  });
}

async function writeCollection(
  root,
  name,
  { source = `fixture:${name}`, context = `${name} source`, pattern = "**/*.md" } = {},
) {
  await fs.writeFile(
    path.join(root, "collections", `${name}.yml`),
    YAML.stringify({ source, context, pattern }, { lineWidth: 0 }),
  );
}

async function writeConnector(root, contents = materializingConnector) {
  await fs.writeFile(path.join(root, "connectors", "fixture.js"), contents);
}

async function writeFile(directory, name, contents = name) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, name), contents);
}

async function qmdIndexGzip(root) {
  const dbPath = path.join(root, "release.sqlite");
  const store = await createStore({ dbPath });
  const now = new Date().toISOString();
  store.internal.insertContent("test-hash", "Filecoin test document", now);
  store.internal.insertDocument("test", "document.md", "Test", "test-hash", now, now);
  await store.close();
  return gzipSync(await fs.readFile(dbPath));
}

test("config generates QMD collections from the current manifest schema", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCollection(root, "lotus", {
    source: "github:filecoin-project/lotus",
    context: "Lotus source",
    pattern: "**/*.{md,go}",
  });

  await runCli(root, "config");

  const generated = YAML.parse(await fs.readFile(qmdConfigFile(root), "utf8"));
  assert.deepEqual(generated, {
    collections: {
      lotus: {
        path: path.join(root, ".filoscope", "collections", "lotus"),
        pattern: "**/*.{md,go}",
        context: { "/": "Lotus source" },
      },
    },
  });
});

test("config respects QMD_CONFIG_DIR", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCollection(root, "demo");
  const configDir = path.join(root, "custom-qmd-config");

  await execFileAsync(process.execPath, [cli, "config"], {
    cwd: root,
    encoding: "utf8",
    env: xdgEnv(root, { QMD_CONFIG_DIR: configDir }),
  });

  const generated = YAML.parse(await fs.readFile(path.join(configDir, "filoscope.yml"), "utf8"));
  assert.equal(generated.collections.demo.context["/"], "demo source");
});

test("config rejects manifests outside the current schema", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "collections", "demo.yml"),
    'source: fixture:demo\ncontext: Demo\npattern:\n  - "**/*.md"\n',
  );

  await assert.rejects(runCli(root, "config"), (error) => {
    assert.match(error.stderr, /Collection field "pattern" must be a non-empty string/);
    return true;
  });
});

test("shipped manifests map exactly to bundled connectors", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(repositoryRoot, "collections"), path.join(root, "collections"), {
    recursive: true,
  });

  await runCli(root, "config");

  const manifests = (await fs.readdir(path.join(root, "collections")))
    .filter((file) => file.endsWith(".yml"))
    .sort();
  const generated = YAML.parse(await fs.readFile(qmdConfigFile(root), "utf8"));
  assert.deepEqual(
    Object.keys(generated.collections),
    manifests.map((file) => path.basename(file, ".yml")),
  );

  const schemes = new Set();
  for (const file of manifests) {
    const collection = YAML.parse(await fs.readFile(path.join(root, "collections", file), "utf8"));
    schemes.add(collection.source.slice(0, collection.source.indexOf(":")));
  }
  const connectors = (await fs.readdir(path.join(repositoryRoot, "connectors")))
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.basename(file, ".js"))
    .sort();
  assert.deepEqual([...schemes].sort(), connectors);
});

test("QMD indexes generated collections through the filoscope named index", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCollection(root, "demo");
  await writeFile(
    path.join(root, ".filoscope", "collections", "demo"),
    "document.md",
    "unique nested QMD marker",
  );
  await runCli(root, "config");

  const elsewhere = path.join(root, "elsewhere");
  await fs.mkdir(elsewhere);
  const env = xdgEnv(root);
  await execFileAsync(process.execPath, [qmd, "--index", "filoscope", "update"], {
    cwd: elsewhere,
    encoding: "utf8",
    env,
  });
  const { stdout } = await execFileAsync(
    process.execPath,
    [qmd, "--index", "filoscope", "search", '"unique nested QMD marker"', "-c", "demo", "--format", "json"],
    { cwd: elsewhere, encoding: "utf8", env },
  );

  const results = JSON.parse(stdout);
  assert.equal(results.length, 1);
  assert.equal(results[0].file, "qmd://demo/document.md?index=filoscope");
});

test("CLI uses the nearest workspace", async (t) => {
  const outer = await fixture();
  t.after(() => fs.rm(outer, { recursive: true, force: true }));
  await writeCollection(outer, "outer");

  const inner = path.join(outer, "nested-workspace");
  const workingDirectory = path.join(inner, "one", "two");
  await fs.mkdir(path.join(inner, "collections"), { recursive: true });
  await fs.mkdir(path.join(inner, "connectors"));
  await fs.mkdir(workingDirectory, { recursive: true });
  await writeCollection(inner, "inner");
  await writeConnector(inner);

  await runCli(workingDirectory, "sync", "inner");

  const generated = YAML.parse(await fs.readFile(qmdConfigFile(workingDirectory), "utf8"));
  assert.deepEqual(Object.keys(generated.collections), ["inner"]);
  assert.equal(
    await fs.readFile(path.join(inner, ".filoscope", "collections", "inner", "inner.md"), "utf8"),
    "inner",
  );
  await assert.rejects(fs.access(path.join(outer, ".filoscope")), { code: "ENOENT" });
});

test("targeted sync replaces only selected collections", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const materialized = path.join(root, ".filoscope", "collections");
  await writeConnector(root);
  await writeCollection(root, "alpha", { source: "fixture:first" });
  await writeCollection(root, "beta");
  await writeFile(path.join(materialized, "beta"), "existing.md");
  await writeFile(path.join(materialized, "orphan"), "existing.md");

  await runCli(root, "sync", "alpha");
  await writeCollection(root, "alpha", { source: "fixture:second" });
  await runCli(root, "sync", "alpha");

  assert.deepEqual(await fs.readdir(path.join(materialized, "alpha")), ["second.md"]);
  assert.equal(await fs.readFile(path.join(materialized, "beta", "existing.md"), "utf8"), "existing.md");
  assert.equal(await fs.readFile(path.join(materialized, "orphan", "existing.md"), "utf8"), "existing.md");
});

test("full sync converges the materialized root", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const materialized = path.join(root, ".filoscope", "collections");
  await writeConnector(root);
  await writeCollection(root, "alpha");
  await writeCollection(root, "beta");
  await writeFile(path.join(materialized, "orphan"), "old.md");
  await writeFile(path.join(materialized, ".orphan.tmp"), "old.md");
  await writeFile(path.join(materialized, ".orphan.backup"), "old.md");

  await runCli(root, "sync");
  assert.deepEqual(await fs.readdir(materialized), ["alpha", "beta"]);

  await fs.rm(path.join(root, "collections", "beta.yml"));
  await writeFile(path.join(materialized, ".beta.tmp"), "old.md");
  await writeFile(path.join(materialized, ".beta.backup"), "old.md");
  await runCli(root, "sync");
  assert.deepEqual(await fs.readdir(materialized), ["alpha"]);
});

test("failed full sync keeps completed updates and preserves the failed collection", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const materialized = path.join(root, ".filoscope", "collections");
  await writeConnector(root);
  await writeCollection(root, "alpha", { source: "fixture:old-alpha" });
  await writeCollection(root, "beta", { source: "fixture:old-beta" });
  await runCli(root, "sync");

  await writeConnector(root, `${materializingConnector}\nif (source === "new-beta") throw new Error("connector failed");\n`);
  await writeCollection(root, "alpha", { source: "fixture:new-alpha" });
  await writeCollection(root, "beta", { source: "fixture:new-beta" });
  await assert.rejects(runCli(root, "sync"));

  assert.deepEqual(await fs.readdir(path.join(materialized, "alpha")), ["new-alpha.md"]);
  assert.deepEqual(await fs.readdir(path.join(materialized, "beta")), ["old-beta.md"]);
});

test("sync checks GitHub discussion authentication before materializing collections", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeConnector(root);
  await writeCollection(root, "alpha");
  await writeCollection(root, "discussions", { source: "github-discussion:owner/repo" });
  const env = xdgEnv(root);
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "sync"], { cwd: root, encoding: "utf8", env }),
    (error) => {
      assert.match(error.stderr, /GITHUB_TOKEN or GH_TOKEN is required to sync GitHub discussions/);
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(root, ".filoscope")), { code: "ENOENT" });
});

test("sync keeps connector progress separate from command output", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeConnector(root, `${materializingConnector}\nconsole.log("connector output");\n`);
  await writeCollection(root, "demo");

  const { stdout, stderr } = await runCli(root, "sync", "demo");

  assert.match(stderr, /\[1\/1\] demo RUN\b/);
  assert.match(stderr, /connector output/);
  assert.match(stderr, /\[1\/1\] demo OK\b.*\b1 files\b/);
  assert.equal(stdout, `demo: 1 files\nGenerated ${qmdConfigFile(root)}\n`);
});

test("publish rejects arguments", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(runCli(root, "publish", "unexpected"), (error) => {
    assert.match(error.stderr, /Usage: filoscope publish/);
    return true;
  });
});

test("publish requires a GitHub token before syncing", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCollection(root, "demo");
  await writeConnector(root);
  const env = xdgEnv(root);
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "publish"], {
      cwd: root,
      encoding: "utf8",
      env,
    }),
    (error) => {
      assert.match(error.stderr, /filoscope publish requires GH_TOKEN or GITHUB_TOKEN/);
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(root, ".filoscope")), { code: "ENOENT" });
});

test("publish rejects a dirty worktree before syncing", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCollection(root, "demo");
  await writeConnector(root);
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Filoscope Test",
      "-c",
      "user.email=filoscope@example.com",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: root },
  );
  await fs.appendFile(path.join(root, "collections", "demo.yml"), "# dirty\n");
  const env = { ...xdgEnv(root), GH_TOKEN: "test" };

  await assert.rejects(
    execFileAsync(process.execPath, [cli, "publish"], {
      cwd: root,
      encoding: "utf8",
      env,
    }),
    (error) => {
      assert.match(error.stderr, /filoscope publish requires a clean Git worktree/);
      return true;
    },
  );
  await assert.rejects(fs.access(path.join(root, ".filoscope")), { code: "ENOENT" });
});

test("pull skips the latest published index unless the database is missing", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const tag = "filoscope-index-20260710T153012Z";
  const artifact = await qmdIndexGzip(root);
  let assetDownloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/release") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        tag_name: tag,
        assets: [{
          name: "filoscope.sqlite.gz",
          browser_download_url: `http://127.0.0.1:${server.address().port}/filoscope.sqlite.gz`,
        }],
      }));
      return;
    }
    assetDownloads++;
    response.end(artifact);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const previousCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(root, "xdg", "cache");
  t.after(() => {
    if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCacheHome;
  });

  const releaseUrl = `http://127.0.0.1:${server.address().port}/release`;
  const first = await pullIndex(releaseUrl);
  const second = await pullIndex(releaseUrl);
  const destination = path.join(root, "xdg", "cache", "qmd", "filoscope.sqlite");
  const tagPath = path.join(root, "xdg", "cache", "qmd", "filoscope.release-tag.txt");

  assert.deepEqual(first, { destination, tag, updated: true });
  assert.deepEqual(second, { destination, tag, updated: false });
  assert.equal(assetDownloads, 1);
  assert.equal((await fs.readFile(destination)).subarray(0, 15).toString(), "SQLite format 3");
  assert.equal(await fs.readFile(tagPath, "utf8"), `${tag}\n`);

  await fs.rm(destination);
  assert.deepEqual(await pullIndex(releaseUrl), { destination, tag, updated: true });
  assert.equal(assetDownloads, 2);
});

test("pull rejects an invalid database and preserves the current index and release tag", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const tag = "filoscope-index-20260710T153013Z";
  const server = createServer((request, response) => {
    if (request.url === "/release") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        tag_name: tag,
        assets: [{
          name: "filoscope.sqlite.gz",
          browser_download_url: `http://127.0.0.1:${server.address().port}/filoscope.sqlite.gz`,
        }],
      }));
      return;
    }
    response.end(gzipSync("not a SQLite database"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const previousCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(root, "xdg", "cache");
  t.after(() => {
    if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCacheHome;
  });

  const cache = path.join(root, "xdg", "cache", "qmd");
  const destination = path.join(cache, "filoscope.sqlite");
  const tagPath = path.join(cache, "filoscope.release-tag.txt");
  await writeFile(cache, "filoscope.sqlite", "current index");
  await writeFile(cache, "filoscope.release-tag.txt", "filoscope-index-20260710T153012Z\n");

  await assert.rejects(
    pullIndex(`http://127.0.0.1:${server.address().port}/release`),
  );
  assert.equal(await fs.readFile(destination, "utf8"), "current index");
  assert.equal(await fs.readFile(tagPath, "utf8"), "filoscope-index-20260710T153012Z\n");
  await assert.rejects(fs.access(`${destination}.tmp`), { code: "ENOENT" });
  await assert.rejects(fs.access(`${tagPath}.tmp`), { code: "ENOENT" });
});
