import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { googleDriveDocuments } from "../src/connectors/google-drive.ts";
import type { GoogleDriveOptions } from "../src/connectors/google-drive.ts";
import type { OkfDocument } from "../src/types.ts";

const source: GoogleDriveOptions = {
  name: "fixture-folder",
  context: "Fixture Drive documents.",
  folderId: "root",
};

test("Google Drive emits hierarchy, minimal frontmatter, comments, and individual files", async (t) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/files" && url.searchParams.get("q")?.includes("'root'")) {
      response.end(JSON.stringify({ files: [
        { id: "folder-1", name: "Reports", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-01-01T00:00:00Z" },
        { id: "doc-root", name: "Overview", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-01-02T00:00:00Z", webViewLink: "https://drive.test/doc-root" },
        { id: "shortcut-1", name: "Plan", mimeType: "application/vnd.google-apps.shortcut", modifiedTime: "2026-01-05T00:00:00Z", webViewLink: "https://drive.test/shortcut-1" },
      ] }));
      return;
    }
    if (url.pathname === "/files" && url.searchParams.get("q")?.includes("'folder-1'")) {
      response.end(JSON.stringify({ files: [
        { id: "text-1", name: "Notes.txt", mimeType: "text/plain", modifiedTime: "2026-01-03T00:00:00Z" },
      ] }));
      return;
    }
    if (url.pathname === "/files/doc-root" && url.searchParams.has("fields")) {
      response.end(JSON.stringify({
        id: "doc-root",
        name: "Overview",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-01-02T00:00:00Z",
        webViewLink: "https://drive.test/doc-root",
      }));
      return;
    }
    if (url.pathname === "/files/doc-root/export") {
      response.setHeader("content-type", "text/markdown");
      response.end("# Overview\n\nDrive body");
      return;
    }
    if (url.pathname === "/files/text-1" && url.searchParams.get("alt") === "media") {
      response.setHeader("content-type", "text/plain");
      response.end("Nested notes");
      return;
    }
    if (url.pathname === "/files/doc-root/comments") {
      response.end(JSON.stringify({ comments: [{
        id: "comment-1",
        author: { displayName: "Ada" },
        content: "Keep this detail",
        createdTime: "2026-01-04T00:00:00Z",
        modifiedTime: "2026-01-04T01:00:00Z",
        resolved: false,
        replies: [{
          id: "reply-1",
          author: { displayName: "Grace" },
          content: "Agreed",
          createdTime: "2026-01-04T02:00:00Z",
        }],
      }] }));
      return;
    }
    if (url.pathname === "/files/text-1/comments") {
      response.end(JSON.stringify({ comments: [] }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: url.pathname }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const options = { accessToken: "fixture-token", apiBase: `http://127.0.0.1:${address.port}` };

  const documents = await collect(googleDriveDocuments(source, options));
  assert.equal(documents.length, 3);
  const root = documents.find((document) => document.path === "Overview--doc-root.md");
  assert(root);
  assert.deepEqual(root.frontmatter, {
    type: "Reference",
    title: "Overview",
    context: "Fixture Drive documents.",
    resource: "https://drive.test/doc-root",
    updated_at: "2026-01-04T02:00:00Z",
  });
  assert.match(root.body, /# Comments/);
  assert.match(root.body, /Keep this detail/);
  assert.match(root.body, /Agreed/);

  const nested = documents.find((document) => document.path === "Reports/Notes.txt--text-1.md");
  assert(nested);
  assert.match(nested.body, /Nested notes/);

  const shortcut = documents.find((document) => document.path === "Plan--shortcut-1.md");
  assert(shortcut);
  assert.match(shortcut.body, /\[Open the Google Drive shortcut\]\(https:\/\/drive\.test\/shortcut-1\)/);

  const direct = await collect(googleDriveDocuments(
    { name: "fixture-file", context: "One fixture document.", fileId: "doc-root" },
    options,
  ));
  assert.equal(direct.length, 1);
  assert.equal(direct[0]?.path, "Overview--doc-root.md");
});

async function collect(documents: AsyncIterable<OkfDocument>): Promise<OkfDocument[]> {
  const result: OkfDocument[] = [];
  for await (const document of documents) result.push(document);
  return result;
}
