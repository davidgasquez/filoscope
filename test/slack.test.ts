import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { slackDocuments } from "../src/connectors/slack.ts";
import type { SlackOptions } from "../src/connectors/slack.ts";
import type { OkfDocument } from "../src/types.ts";

const source: SlackOptions = {
  name: "engineering",
  context: "Engineering discussions and decisions.",
  channelId: "C123ENGINEERING",
};

test("Slack emits one Markdown conversation per thread or top-level message", async (t) => {
  const requests: { method: string; authorization?: string; body: URLSearchParams }[] = [];
  const server = createServer(async (request, response) => {
    const body = new URLSearchParams(await readBody(request));
    const method = request.url?.replace(/^\//, "") ?? "";
    requests.push({
      method,
      authorization: request.headers.authorization,
      body,
    });
    response.setHeader("content-type", "application/json");

    if (method === "auth.test") {
      response.end(JSON.stringify({ ok: true, url: "https://fixture.slack.com/" }));
      return;
    }
    if (method === "users.list") {
      response.end(JSON.stringify({
        ok: true,
        members: [
          { id: "UADA", profile: { display_name: "Ada" } },
          { id: "UGRACE", profile: { real_name: "Grace Hopper" } },
        ],
        response_metadata: { next_cursor: "" },
      }));
      return;
    }
    if (method === "conversations.history" && !body.get("cursor")) {
      response.end(JSON.stringify({
        ok: true,
        messages: [
          {
            type: "message",
            user: "UADA",
            text: "Standalone *runbook* at <https://example.test/runbook|the runbook>",
            ts: "1704240000.000003",
            files: [{ id: "F1", title: "Logs", permalink: "https://fixture.slack.com/files/F1" }],
          },
          {
            type: "message",
            subtype: "thread_broadcast",
            user: "UGRACE",
            text: "Thread reply broadcast",
            thread_ts: "1704067200.000001",
            ts: "1704153600.000002",
          },
        ],
        response_metadata: { next_cursor: "history-page-2" },
      }));
      return;
    }
    if (method === "conversations.history" && body.get("cursor") === "history-page-2") {
      response.end(JSON.stringify({
        ok: true,
        messages: [{
          type: "message",
          user: "UADA",
          text: "Why does restore stall, <@UGRACE>?",
          thread_ts: "1704067200.000001",
          reply_count: 1,
          latest_reply: "1704153600.000002",
          ts: "1704067200.000001",
          reactions: [{ name: "bulb", count: 2 }],
        }],
        response_metadata: { next_cursor: "" },
      }));
      return;
    }
    if (method === "conversations.replies") {
      response.end(JSON.stringify({
        ok: true,
        messages: [
          {
            type: "message",
            user: "UADA",
            text: "Why does restore stall, <@UGRACE>?",
            thread_ts: "1704067200.000001",
            reply_count: 1,
            latest_reply: "1704153600.000002",
            ts: "1704067200.000001",
            reactions: [{ name: "bulb", count: 2 }],
          },
          {
            type: "message",
            user: "UGRACE",
            text: "Set `CKPT_PREFETCH=4` &amp; retry in <#C123ENGINEERING|engineering>.",
            thread_ts: "1704067200.000001",
            ts: "1704153600.000002",
            edited: { ts: "1704157200.000004" },
          },
        ],
        response_metadata: { next_cursor: "" },
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: `Unexpected ${method}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");

  const documents = await collect(slackDocuments(source, {
    token: "xoxb-fixture",
    apiBase: `http://127.0.0.1:${address.port}`,
  }));

  assert.equal(documents.length, 2);
  const thread = documents[0];
  assert(thread);
  assert.equal(thread.path, "2024-01-01/1704067200-000001.md");
  assert.deepEqual(thread.frontmatter, {
    type: "Conversation",
    title: "Ada: Why does restore stall, @Grace Hopper?",
    context: "Engineering discussions and decisions.",
    resource: "https://fixture.slack.com/archives/C123ENGINEERING/p1704067200000001",
    updated_at: "2024-01-02T01:00:00.000Z",
  });
  assert.match(thread.body, /## Ada — 2024-01-01T00:00:00\.000Z/);
  assert.match(thread.body, /## Grace Hopper — 2024-01-02T00:00:00\.000Z/);
  assert.match(thread.body, /Set `CKPT_PREFETCH=4` & retry in #engineering\./);
  assert.match(thread.body, /\*\*Reactions:\*\* :bulb: × 2/);
  assert.match(thread.body, /_Edited 2024-01-02T01:00:00\.000Z_/);

  const standalone = documents[1];
  assert(standalone);
  assert.equal(standalone.path, "2024-01-03/1704240000-000003.md");
  assert.match(standalone.body, /Standalone \*\*runbook\*\*/);
  assert.match(standalone.body, /\[the runbook]\(https:\/\/example\.test\/runbook\)/);
  assert.match(standalone.body, /\[Logs]\(https:\/\/fixture\.slack\.com\/files\/F1\)/);

  assert(requests.every((request) => request.authorization === "Bearer xoxb-fixture"));
  assert.equal(requests.filter((request) => request.method === "conversations.replies").length, 1);
  assert.equal(requests.find((request) => request.body.get("cursor") === "history-page-2")?.body.get("limit"), "200");
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
