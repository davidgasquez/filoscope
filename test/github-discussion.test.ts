import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  githubDiscussion,
  githubDiscussionDocuments,
} from "../src/connectors/github-discussion.ts";
import type { GitHubDiscussionOptions } from "../src/connectors/github-discussion.ts";
import type { OkfDocument } from "../src/types.ts";

const collection: GitHubDiscussionOptions = {
  name: "fips-discussions",
  context: "FIP design discussions.",
  repository: "filecoin-project/FIPs",
};

test("GitHub Discussions emits deterministic OKF conversations with all replies", async (t) => {
  const requests: { authorization?: string; variables: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    requests.push({ authorization: request.headers.authorization, variables: body.variables });
    response.setHeader("content-type", "application/json");

    if (body.query.includes("discussions(first")) {
      response.end(JSON.stringify({ data: { repository: { discussions: {
        totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          id: "discussion-7",
          number: 7,
          title: "Change block limits?",
          url: "https://github.test/discussions/7",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-04T00:00:00Z",
          body: "Proposal body",
          author: { login: "ada", url: "https://github.test/ada" },
          category: { name: "Ideas" },
        }],
      } } } }));
      return;
    }
    if (body.query.includes("... on DiscussionComment")) {
      response.end(JSON.stringify({ data: { node: { replies: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          body: "Second reply",
          url: "https://github.test/reply/2",
          createdAt: "2026-01-03T00:00:00Z",
          author: { login: "lin" },
        }],
      } } } }));
      return;
    }
    if (body.query.includes("comments(first")) {
      response.end(JSON.stringify({ data: { node: { comments: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          id: "comment-1",
          body: "Comment body",
          url: "https://github.test/comment/1",
          createdAt: "2026-01-02T00:00:00Z",
          author: { login: "grace" },
          replies: {
            pageInfo: { hasNextPage: true, endCursor: "reply-page-2" },
            nodes: [{
              body: "First reply",
              url: "https://github.test/reply/1",
              createdAt: "2026-01-02T12:00:00Z",
              author: { login: "ada" },
            }],
          },
        }],
      } } } }));
      return;
    }
    response.statusCode = 400;
    response.end(JSON.stringify({ errors: [{ message: "Unexpected query" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const documents = await collect(githubDiscussionDocuments(collection, {
    token: "fixture-token",
    apiUrl: `http://127.0.0.1:${address.port}`,
  }));
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.path, "0007-Change-block-limits.md");
  assert.deepEqual(documents[0]?.frontmatter, {
    type: "Conversation",
    title: "#7 Change block limits?",
    context: "FIP design discussions.",
    resource: "https://github.test/discussions/7",
    updated_at: "2026-01-04T00:00:00Z",
  });
  assert.match(documents[0]!.body, /Proposal body/);
  assert.match(documents[0]!.body, /First reply/);
  assert.match(documents[0]!.body, /Second reply/);
  assert(requests.every((request) => request.authorization === "Bearer fixture-token"));
  assert.equal(requests.at(-1)?.variables.cursor, "reply-page-2");
});

test("GitHub Discussions validates configuration without requiring credentials", () => {
  const defined = githubDiscussion(collection);
  assert.deepEqual({ name: defined.name, context: defined.context }, {
    name: collection.name,
    context: collection.context,
  });
  assert.throws(
    () => githubDiscussion({ ...collection, extra: true } as GitHubDiscussionOptions),
    /Unknown GitHub discussion collection field "extra"/,
  );
});

test("GitHub Discussions checks credentials only when it materializes", async (t) => {
  const previousGitHubToken = process.env.GITHUB_TOKEN;
  const previousGhToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  t.after(() => {
    if (previousGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGitHubToken;
    if (previousGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousGhToken;
  });

  const defined = githubDiscussion(collection);
  await assert.rejects(
    defined.materialize("unused"),
    /authentication requires GITHUB_TOKEN or GH_TOKEN/,
  );
});

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function collect(documents: AsyncIterable<OkfDocument>): Promise<OkfDocument[]> {
  const result: OkfDocument[] = [];
  for await (const document of documents) result.push(document);
  return result;
}
