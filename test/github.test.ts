import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tar from "tar";
import { github, githubMaterialize } from "../src/connectors/github.ts";
import type { GitHubOptions } from "../src/connectors/github.ts";

const collection: GitHubOptions = {
  name: "fixture-repository",
  context: "Fixture GitHub repository.",
  repository: "protocol/plrd.org",
  include: "**/*.md",
};

test("GitHub preserves selected source bytes and paths", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "filoscope-github-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archiveRoot = path.join(root, "archive", "protocol-plrd-fixture");
  await fs.mkdir(path.join(archiveRoot, "content", "about"), { recursive: true });
  await fs.mkdir(path.join(archiveRoot, "src"), { recursive: true });
  const markdown = Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0x23, 0x20, 0x46, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x0a]);
  await fs.writeFile(path.join(archiveRoot, "README.md"), "# Fixture\n");
  await fs.writeFile(path.join(archiveRoot, "content", "about", "index.md"), markdown);
  await fs.writeFile(path.join(archiveRoot, "src", "index.ts"), "export {};\n");

  const archive = path.join(root, "repository.tgz");
  await tar.c({ cwd: path.join(root, "archive"), file: archive, gzip: true }, ["protocol-plrd-fixture"]);
  const archiveBytes = await fs.readFile(archive);
  let request: { url?: string; authorization?: string } | undefined;
  const server = createServer((incoming, response) => {
    request = { url: incoming.url, authorization: incoming.headers.authorization };
    response.end(archiveBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const destination = path.join(root, "output");
  await fs.mkdir(destination);
  await githubMaterialize(collection, destination, {
    token: "fixture-token",
    apiBase: `http://127.0.0.1:${address.port}`,
  });

  assert.deepEqual(await fs.readdir(destination), ["README.md", "content"]);
  assert.deepEqual(await fs.readFile(path.join(destination, "content", "about", "index.md")), markdown);
  await assert.rejects(fs.access(path.join(destination, "src", "index.ts")), { code: "ENOENT" });
  assert.deepEqual(request, {
    url: "/repos/protocol/plrd.org/tarball",
    authorization: "Bearer fixture-token",
  });
});

test("GitHub validates connector fields when the collection is defined", () => {
  assert.throws(
    () => github({ ...collection, unknown: true } as GitHubOptions),
    /Unknown GitHub collection field "unknown"/,
  );
  assert.throws(
    () => github({ ...collection, repository: "missing-slash" }),
    /must be owner\/repo/,
  );
});
