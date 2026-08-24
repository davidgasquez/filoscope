import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { defineCollection } from "../src/collection.ts";
import { loadAreas, loadCollections } from "../src/config.ts";
import { materializeOkfDocuments } from "../src/materialize.ts";
import { syncCollections } from "../src/sync.ts";
import type { Collection, OkfDocument } from "../src/types.ts";

async function temporary(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-kernel-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("defineCollection normalizes common fields and closes over its materializer", async () => {
  let capturedDestination: string | undefined;
  const collection = defineCollection(
    { name: " docs ", context: " Reference files " },
    async (destination) => {
      capturedDestination = destination;
    },
  );

  assert.deepEqual(Object.keys(collection), ["name", "context", "materialize"]);
  assert.deepEqual({ name: collection.name, context: collection.context }, {
    name: "docs",
    context: "Reference files",
  });
  await collection.materialize("destination");
  assert.equal(capturedDestination, "destination");
});

test("collection discovery is sorted and requires one definition per file", async (t) => {
  const root = await temporary(t);
  await fs.writeFile(
    path.join(root, "b.ts"),
    `export default { name: "single", context: "Single", materialize: async () => {} };\n`,
  );
  await fs.writeFile(
    path.join(root, "a.ts"),
    `export default { name: "first", context: "First", materialize: async () => {} };\n`,
  );

  const collections = await loadCollections(root);
  assert.deepEqual(collections.map((collection) => collection.name), ["first", "single"]);

  await fs.writeFile(
    path.join(root, "c.ts"),
    `export default { name: "first", context: "Duplicate", materialize: async () => {} };\n`,
  );
  await assert.rejects(loadCollections(root), /Duplicate collection name: first/);

  await fs.writeFile(
    path.join(root, "array.ts"),
    `export default [{ name: "array", context: "Array", materialize: async () => {} }];\n`,
  );
  await assert.rejects(loadCollections(root), /must export exactly one definition/);
});

test("areas reference collection names and reject unknown references", async (t) => {
  const root = await temporary(t);
  const collectionsDirectory = path.join(root, "collections");
  const areasDirectory = path.join(root, "areas");
  await Promise.all([
    fs.mkdir(collectionsDirectory),
    fs.mkdir(areasDirectory),
  ]);
  for (const name of ["alpha", "beta"]) {
    await fs.writeFile(
      path.join(collectionsDirectory, `${name}.ts`),
      `export default { name: ${JSON.stringify(name)}, context: ${JSON.stringify(name)}, materialize: async () => {} };\n`,
    );
  }
  await fs.writeFile(
    path.join(areasDirectory, "focused.ts"),
    `export default {
       name: "focused",
       description: "Focused collections",
       collections: ["alpha", "beta"],
     };\n`,
  );

  const collections = await loadCollections(collectionsDirectory);
  const areas = await loadAreas(areasDirectory, collections);
  assert.deepEqual(areas.map((area) => ({
    name: area.name,
    collections: area.collections,
  })), [{ name: "focused", collections: ["alpha", "beta"] }]);

  await fs.writeFile(
    path.join(areasDirectory, "unknown.ts"),
    `export default {
       name: "unknown",
       description: "Unknown collection",
       collections: ["missing"],
     };\n`,
  );
  await assert.rejects(loadAreas(areasDirectory, collections), /unknown collection "missing"/i);
});

test("the OKF writer emits exact frontmatter and rejects unsafe or duplicate paths", async (t) => {
  const root = await temporary(t);
  const valid: OkfDocument = {
    path: "nested/document.md",
    frontmatter: {
      type: "Reference",
      title: "Document",
      context: "Fixture context",
      resource: "https://example.test/document",
      updated_at: "2026-08-20T10:00:00Z",
    },
    body: "# Body\n",
  };
  await materializeOkfDocuments(documents(valid), root);
  const output = await fs.readFile(path.join(root, valid.path), "utf8");
  const [, yaml, body] = output.match(/^---\n([\s\S]*?)---\n\n([\s\S]*)$/) ?? [];
  assert.deepEqual(YAML.parse(yaml!), valid.frontmatter);
  assert.equal(body, "# Body\n");

  await assert.rejects(
    materializeOkfDocuments(documents({ ...valid, path: "../escape.md" }), root),
    /normalized and relative/,
  );
  await assert.rejects(
    materializeOkfDocuments(documents(valid, valid), root),
    /duplicate path/,
  );
  await assert.rejects(
    materializeOkfDocuments(documents({
      ...valid,
      frontmatter: { ...valid.frontmatter, extra: "invalid" } as typeof valid.frontmatter,
    }), root),
    /frontmatter must contain exactly/,
  );
});

test("full and targeted syncs converge while failures preserve prior directories", async (t) => {
  const root = await temporary(t);
  const output = path.join(root, "collections");
  const values = new Map([ ["alpha", "old-alpha"], ["beta", "old-beta"] ]);
  const collections = [
    fixtureCollection("alpha", values),
    fixtureCollection("beta", values),
  ];

  await syncCollections(collections, [], output);
  await writeFile(path.join(output, "orphan"), "old.md", "old");
  values.set("alpha", "new-alpha");
  await syncCollections(collections, ["alpha"], output);
  assert.equal(await fs.readFile(path.join(output, "alpha", "document.md"), "utf8"), "new-alpha");
  assert.equal(await fs.readFile(path.join(output, "orphan", "old.md"), "utf8"), "old");

  values.set("beta", "FAIL");
  await assert.rejects(syncCollections(collections, [], output), /Failed to sync "beta"/);
  assert.equal(await fs.readFile(path.join(output, "beta", "document.md"), "utf8"), "old-beta");
  assert.equal(await fs.readFile(path.join(output, "alpha", "document.md"), "utf8"), "new-alpha");

  values.set("beta", "new-beta");
  await writeFile(path.join(output, ".orphan.tmp"), "old.md", "old");
  await writeFile(path.join(output, ".orphan.backup"), "old.md", "old");
  await syncCollections(collections, [], output);
  assert.deepEqual(await fs.readdir(output), ["alpha", "beta"]);

  const firstHash = await treeHash(output);
  await syncCollections(collections, [], output);
  assert.equal(await treeHash(output), firstHash);

  await fs.rename(path.join(output, "alpha"), path.join(output, ".alpha.backup"));
  values.set("alpha", "FAIL");
  await assert.rejects(syncCollections(collections, ["alpha"], output), /fixture failed/);
  assert.equal(await fs.readFile(path.join(output, "alpha", "document.md"), "utf8"), "new-alpha");
});

test("sync rejects an empty refresh and preserves the installed collection", async (t) => {
  const root = await temporary(t);
  const output = path.join(root, "collections");
  const installed = defineCollection({ name: "docs", context: "Docs" }, async (destination) => {
    await fs.writeFile(path.join(destination, "document.md"), "installed");
  });
  await syncCollections([installed], [], output);

  const empty = defineCollection({ name: "docs", context: "Docs" }, async () => {});
  await assert.rejects(syncCollections([empty], [], output), /materialized 0 files/);
  assert.equal(await fs.readFile(path.join(output, "docs", "document.md"), "utf8"), "installed");
});

function fixtureCollection(name: string, values: Map<string, string>): Collection {
  return defineCollection({ name, context: `${name} fixture` }, async (destination) => {
    const value = values.get(name);
    if (value === "FAIL") throw new Error("fixture failed");
    if (value === undefined) throw new Error(`Missing fixture value for ${name}`);
    await fs.writeFile(path.join(destination, "document.md"), value);
  });
}

async function* documents(...values: OkfDocument[]): AsyncGenerator<OkfDocument> {
  yield* values;
}

async function writeFile(directory: string, name: string, contents: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, name), contents);
}

async function treeHash(root: string): Promise<string> {
  const entries = (await fs.readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(root, entry)));
  }
  return hash.digest("hex");
}
