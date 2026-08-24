import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the packed package runs its compiled bin with bundled and local definitions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-package-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stdout: packOutput } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", root],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const packed = JSON.parse(packOutput) as
    | { filename: string }[]
    | Record<string, { filename: string }>;
  const packages = Array.isArray(packed) ? packed : Object.values(packed);
  assert.equal(packages.length, 1);
  const tarball = path.join(root, packages[0]!.filename);
  const { stdout: listing } = await execFileAsync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assert.match(listing, /package\/dist\/src\/cli\.js/);
  assert.match(listing, /package\/dist\/collections\/lotus\.js/);
  assert.match(listing, /package\/LICENSE/);
  assert.match(listing, /package\/README\.md/);
  assert.match(listing, /package\/SKILL\.md/);
  assert.doesNotMatch(listing, /package\/src\/|\.yml$/m);

  await execFileAsync(
    "npm",
    ["install", "--ignore-scripts", "--allow-remote=all", tarball],
    { cwd: root, encoding: "utf8" },
  );
  const bin = path.join(root, "node_modules", ".bin", "filoscope");
  const { stdout: help } = await execFileAsync(bin, ["--help"], { cwd: root, encoding: "utf8" });
  assert.match(help, /filoscope sync/);
  const { stdout: areas } = await execFileAsync(bin, ["areas"], { cwd: root, encoding: "utf8" });
  assert.match(areas, /^protocol\t/m);
  await fs.rename(
    path.join(root, "node_modules", "@tobilu", "qmd"),
    path.join(root, "node_modules", "@tobilu", "qmd.disabled"),
  );

  const workspace = path.join(root, "workspace");
  await Promise.all([
    fs.mkdir(path.join(workspace, "collections"), { recursive: true }),
    fs.mkdir(path.join(workspace, "areas"), { recursive: true }),
  ]);
  await fs.writeFile(
    path.join(workspace, "collections", "fixture.ts"),
    `import fs from "node:fs/promises";
     import path from "node:path";
     import { defineCollection } from "filoscope/dist/src/collection.js";
     export default defineCollection({ name: "fixture", context: "Packed fixture" }, async (destination) => {
       await fs.writeFile(path.join(destination, "document.md"), "packed fixture body");
     });\n`,
  );
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, "xdg", "config"),
    XDG_CACHE_HOME: path.join(root, "xdg", "cache"),
  };
  await execFileAsync(bin, ["sync"], { cwd: workspace, encoding: "utf8", env });
  await execFileAsync(bin, ["config"], { cwd: workspace, encoding: "utf8", env });
  assert.equal(
    await fs.readFile(path.join(workspace, ".filoscope", "collections", "fixture", "document.md"), "utf8"),
    "packed fixture body",
  );
  assert.deepEqual(
    YAML.parse(await fs.readFile(path.join(root, "xdg", "config", "qmd", "filoscope.yml"), "utf8")),
    {
      collections: {
        fixture: {
          path: path.join(workspace, ".filoscope", "collections", "fixture"),
          pattern: "**/*",
          context: { "/": "Packed fixture" },
        },
      },
    },
  );
});
