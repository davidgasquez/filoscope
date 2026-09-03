import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import YAML from "yaml";
import { loadAreas, loadCollections } from "../src/config.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repositoryRoot, "src", "cli.ts");
const qmd = path.resolve(
  path.dirname(fileURLToPath(import.meta.resolve("@tobilu/qmd"))),
  "..",
  "bin",
  "qmd",
);
const collectionModule = pathToFileURL(path.join(repositoryRoot, "src", "collection.ts")).href;

async function fixture(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-cli-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all([
    fs.mkdir(path.join(root, "areas")),
    fs.mkdir(path.join(root, "collections")),
  ]);
  return root;
}

function environment(root: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
    XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
    ...overrides,
  };
}

function configFile(root: string): string {
  return path.join(root, "xdg", "config", "qmd", "filoscope.yml");
}

async function runCli(root: string, ...args: string[]) {
  return await execFileAsync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: environment(root),
  });
}

async function writeCollection(
  root: string,
  name: string,
  contents = name,
  context = `${name} context`,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "collections", `${name}.ts`),
    `import fs from "node:fs/promises";
     import path from "node:path";
     import { defineCollection } from ${JSON.stringify(collectionModule)};
     export default defineCollection({
       name: ${JSON.stringify(name)},
       context: ${JSON.stringify(context)},
     }, async (destination) => {
       await fs.writeFile(path.join(destination, "document.md"), ${JSON.stringify(contents)});
     });\n`,
  );
}

async function writeArea(
  root: string,
  name: string,
  collections: string[],
  description = `${name} area`,
): Promise<void> {
  await fs.writeFile(
    path.join(root, "areas", `${name}.ts`),
    `export default {
       name: ${JSON.stringify(name)},
       description: ${JSON.stringify(description)},
       collections: ${JSON.stringify(collections)},
     };\n`,
  );
}

test("the bundled TypeScript catalog loads with valid area references", async () => {
  const collections = await loadCollections(path.join(repositoryRoot, "collections"));
  const areas = await loadAreas(path.join(repositoryRoot, "areas"), collections);
  assert(collections.length > 0);
  assert(areas.length > 0);
  assert.equal(new Set(collections.map((collection) => collection.name)).size, collections.length);
  assert(areas.every((area) => area.collections.length > 0));
});

test("config uses a fixed QMD pattern for every collection", async (t) => {
  const root = await fixture(t);
  await writeCollection(root, "lotus", "Lotus body", "Lotus source");
  await runCli(root, "config");

  assert.deepEqual(YAML.parse(await fs.readFile(configFile(root), "utf8")), {
    collections: {
      lotus: {
        path: path.join(root, ".filoscope", "collections", "lotus"),
        pattern: "**/*",
        context: { "/": "Lotus source" },
      },
    },
  });
});

test("sync materializes files without generating QMD configuration", async (t) => {
  const root = await fixture(t);
  await writeCollection(root, "demo", "fixture body");
  const result = await runCli(root, "sync");

  assert.equal(result.stdout, "demo: 1 files\n");
  assert.match(result.stderr, /\[1\/1\] demo RUN/);
  assert.equal(
    await fs.readFile(path.join(root, ".filoscope", "collections", "demo", "document.md"), "utf8"),
    "fixture body",
  );
  await assert.rejects(fs.access(configFile(root)), { code: "ENOENT" });
});

test("areas list descriptions and emit QMD filters", async (t) => {
  const root = await fixture(t);
  await writeCollection(root, "alpha");
  await writeCollection(root, "beta");
  await writeArea(root, "focused", ["alpha", "beta"], "Focused sources");

  assert.equal((await runCli(root, "areas")).stdout, "focused\tFocused sources\n");
  assert.equal((await runCli(root, "area", "focused")).stdout, "-c alpha -c beta\n");
  await assert.rejects(runCli(root, "area", "missing"), hasStderr(/Unknown area: missing/));
});

test("the CLI uses the nearest directory containing collections", async (t) => {
  const outer = await fixture(t);
  await writeCollection(outer, "outer");
  const inner = path.join(outer, "nested-workspace");
  const workingDirectory = path.join(inner, "one", "two");
  await fs.mkdir(path.join(inner, "collections"), { recursive: true });
  await fs.mkdir(path.join(inner, "areas"));
  await fs.mkdir(workingDirectory, { recursive: true });
  await writeCollection(inner, "inner");

  await runCli(workingDirectory, "sync", "inner");
  assert.equal(
    await fs.readFile(path.join(inner, ".filoscope", "collections", "inner", "document.md"), "utf8"),
    "inner",
  );
  await assert.rejects(fs.access(path.join(outer, ".filoscope")), { code: "ENOENT" });
});

test("QMD indexes and searches materialized fixture files", async (t) => {
  const root = await fixture(t);
  await writeCollection(root, "demo", "unique nested QMD marker");
  await runCli(root, "sync");
  await runCli(root, "config");
  const elsewhere = path.join(root, "elsewhere");
  await fs.mkdir(elsewhere);
  const env = environment(root);
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
  const results = JSON.parse(stdout) as { file: string }[];
  assert.deepEqual(results.map((result) => result.file), ["qmd://demo/document.md?index=filoscope"]);
});

test("publish validates arguments, credentials, and the Git worktree before sync", async (t) => {
  const root = await fixture(t);
  await writeCollection(root, "demo");
  await assert.rejects(runCli(root, "publish", "unexpected"), hasStderr(/Usage: filoscope publish/));

  const withoutToken = environment(root);
  delete withoutToken.GH_TOKEN;
  delete withoutToken.GITHUB_TOKEN;
  await assert.rejects(
    execFileAsync(process.execPath, [cli, "publish"], {
      cwd: root,
      encoding: "utf8",
      env: withoutToken,
    }),
    hasStderr(/publish requires GH_TOKEN or GITHUB_TOKEN/),
  );
  await assert.rejects(fs.access(path.join(root, ".filoscope")), { code: "ENOENT" });

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
  await fs.appendFile(path.join(root, "collections", "demo.ts"), "// dirty\n");
  await assert.rejects(
    execFileAsync(process.execPath, [cli, "publish"], {
      cwd: root,
      encoding: "utf8",
      env: environment(root, { GH_TOKEN: "fixture" }),
    }),
    hasStderr(/publish requires a clean Git worktree/),
  );
});

function hasStderr(pattern: RegExp): (error: unknown) => boolean {
  return (error) => {
    assert(error && typeof error === "object" && "stderr" in error);
    assert.match(String(error.stderr), pattern);
    return true;
  };
}
