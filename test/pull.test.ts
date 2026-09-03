import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createStore } from "@tobilu/qmd";
import YAML from "yaml";
import { pullIndex } from "../src/qmd/pull.ts";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-pull-test-"));
  const previousCacheHome = process.env.XDG_CACHE_HOME;
  const previousConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CACHE_HOME = path.join(root, "xdg", "cache");
  process.env.XDG_CONFIG_HOME = path.join(root, "xdg", "config");
  t.after(async () => {
    if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCacheHome;
    if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousConfigHome;
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

async function qmdIndexGzip(root: string): Promise<Buffer> {
  const dbPath = path.join(root, "release.sqlite");
  const store = await createStore({
    dbPath,
    config: {
      collections: {
        test: {
          path: root,
          pattern: "**/*.md",
          context: { "/": "Test collection" },
        },
      },
    },
  });
  const now = new Date().toISOString();
  store.internal.insertContent("test-hash", "Filecoin test document", now);
  store.internal.insertDocument("test", "document.md", "Test", "test-hash", now, now);
  await store.close();
  return gzipSync(await fs.readFile(dbPath));
}

test("pull installs a valid index and skips an unchanged release", async (t) => {
  const root = await fixture(t);
  const tag = "filoscope-index-20260710T153012Z";
  const artifact = await qmdIndexGzip(root);
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/release") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{
        tag_name: tag,
        assets: [{
          name: "filoscope.sqlite.gz",
          browser_download_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/filoscope.sqlite.gz`,
        }],
      }]));
      return;
    }
    downloads++;
    response.end(artifact);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const releaseUrl = `http://127.0.0.1:${address.port}/release`;
  const first = await pullIndex(releaseUrl);
  const second = await pullIndex(releaseUrl);
  const destination = path.join(root, "xdg", "cache", "qmd", "filoscope.sqlite");
  assert.deepEqual(first, { destination, tag, updated: true });
  assert.deepEqual(second, { destination, tag, updated: false });
  assert.equal(downloads, 1);
  assert.equal((await fs.readFile(destination)).subarray(0, 15).toString(), "SQLite format 3");
  assert.deepEqual(
    YAML.parse(await fs.readFile(path.join(root, "xdg", "config", "qmd", "filoscope.yml"), "utf8")),
    {
      collections: {
        test: {
          path: root,
          pattern: "**/*.md",
          context: { "/": "Test collection" },
        },
      },
    },
  );
});

test("pull rejects an invalid index without replacing installed files", async (t) => {
  const root = await fixture(t);
  const tag = "filoscope-index-20260710T153013Z";
  const server = createServer((request, response) => {
    if (request.url === "/release") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{
        tag_name: tag,
        assets: [{
          name: "filoscope.sqlite.gz",
          browser_download_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/filoscope.sqlite.gz`,
        }],
      }]));
      return;
    }
    response.end(gzipSync("not a SQLite database"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const cache = path.join(root, "xdg", "cache", "qmd");
  const config = path.join(root, "xdg", "config", "qmd");
  await Promise.all([fs.mkdir(cache, { recursive: true }), fs.mkdir(config, { recursive: true })]);
  await fs.writeFile(path.join(cache, "filoscope.sqlite"), "current index");
  await fs.writeFile(path.join(cache, "filoscope.release-tag.txt"), "previous\n");
  await fs.writeFile(path.join(config, "filoscope.yml"), "collections:\n  current: {}\n");

  await assert.rejects(pullIndex(`http://127.0.0.1:${address.port}/release`));
  assert.equal(await fs.readFile(path.join(cache, "filoscope.sqlite"), "utf8"), "current index");
  assert.equal(await fs.readFile(path.join(cache, "filoscope.release-tag.txt"), "utf8"), "previous\n");
  assert.equal(await fs.readFile(path.join(config, "filoscope.yml"), "utf8"), "collections:\n  current: {}\n");
  await assert.rejects(fs.access(path.join(cache, "filoscope.sqlite.tmp")), { code: "ENOENT" });
});
