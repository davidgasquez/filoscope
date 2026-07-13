#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const maxGraphqlAttempts = 6;
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) {
  console.error("Usage: node connectors/github-discussion.js <owner/repo> <destination>");
  process.exit(1);
}
if (!githubToken) {
  console.error("GITHUB_TOKEN or GH_TOKEN is required for GitHub GraphQL API access.");
  process.exit(1);
}

const repo = parseRepository(sourceArg);
const destinationRoot = path.resolve(process.cwd(), destinationArg);
const discussions = await fetchDiscussions(repo);

await fs.mkdir(destinationRoot, { recursive: true });

for (let index = 0; index < discussions.length; index++) {
  const discussion = discussions[index];
  const comments = await fetchComments(discussion.id);
  const prefix = `${String(discussion.number).padStart(4, "0")}-`;
  const title = safeFileName(discussion.title);
  const fileName = `${prefix}${title || "discussion"}.md`;
  await fs.writeFile(path.join(destinationRoot, fileName), renderDiscussion(discussion, comments));

  const count = index + 1;
  if (count === discussions.length || count % 25 === 0) {
    console.error(`Exported ${count}/${discussions.length} discussion files`);
  }
}

console.error(`Exported ${discussions.length} discussions from ${repo.owner}/${repo.name}`);

async function fetchDiscussions(repo) {
  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        discussions(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            number
            title
            url
            createdAt
            updatedAt
            body
            author { login url }
            category { name }
          }
        }
      }
    }
  `;

  const discussions = [];
  let cursor;
  do {
    const data = await ghGraphql(query, { owner: repo.owner, name: repo.name, cursor });
    const page = data.repository.discussions;
    discussions.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
    console.error(`Fetched ${discussions.length}/${page.totalCount} discussions`);
  } while (cursor);

  return discussions.sort((left, right) => left.number - right.number);
}

async function fetchComments(discussionId) {
  const query = `
    query($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on Discussion {
          comments(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              body
              url
              createdAt
              author { login url }
              replies(first: 100) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  body
                  url
                  createdAt
                  author { login url }
                }
              }
            }
          }
        }
      }
    }
  `;

  const comments = [];
  let cursor;
  do {
    const data = await ghGraphql(query, { id: discussionId, cursor });
    const page = data.node.comments;
    for (const comment of page.nodes) {
      comments.push({
        ...comment,
        replies: await fetchRemainingReplies(comment),
      });
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (cursor);

  return comments;
}

async function fetchRemainingReplies(comment) {
  const replies = [...comment.replies.nodes];
  let cursor = comment.replies.pageInfo.hasNextPage ? comment.replies.pageInfo.endCursor : undefined;
  if (!cursor) return replies;

  const query = `
    query($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on DiscussionComment {
          replies(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              body
              url
              createdAt
              author { login url }
            }
          }
        }
      }
    }
  `;

  do {
    const data = await ghGraphql(query, { id: comment.id, cursor });
    const page = data.node.replies;
    replies.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (cursor);

  return replies;
}

async function ghGraphql(query, variables) {
  for (let attempt = 1; attempt <= maxGraphqlAttempts; attempt++) {
    try {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${githubToken}`,
          "content-type": "application/json",
          "user-agent": "filoscope-github-discussion-connector",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(120_000),
      });

      const body = await response.text();
      if (!response.ok) {
        const message = `${response.status} ${response.statusText}: ${body}`;
        if (!isRetryableGraphqlError(message) || attempt === maxGraphqlAttempts) {
          throw new Error(message);
        }
        await waitForRetry(attempt, message);
        continue;
      }

      const parsed = JSON.parse(body);
      if (parsed.errors?.length) {
        const message = parsed.errors.map((error) => error.message).join("\n");
        if (!isRetryableGraphqlError(message) || attempt === maxGraphqlAttempts) {
          throw new Error(message);
        }
        await waitForRetry(attempt, message);
        continue;
      }
      return parsed.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableGraphqlError(message) || attempt === maxGraphqlAttempts) throw error;
      await waitForRetry(attempt, message);
    }
  }
}

async function waitForRetry(attempt, message) {
  const delayMs = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
  console.error(`GitHub GraphQL request failed (${message.trim()}); retrying in ${Math.round(delayMs / 1000)}s`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableGraphqlError(message) {
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|502|503|504|rate limit|secondary rate/i.test(message);
}

function renderDiscussion(discussion, comments) {
  const lines = [
    `# #${discussion.number} ${discussion.title}`,
    "",
    `URL: ${discussion.url}`,
    `Category: ${discussion.category?.name ?? "Uncategorized"}`,
    `Author: ${formatAuthor(discussion.author)}`,
    `Created: ${discussion.createdAt}`,
    `Updated: ${discussion.updatedAt}`,
    "",
    "## Body",
    "",
    discussion.body?.trim() || "_No body._",
    "",
    "## Comments",
    "",
  ];

  if (comments.length === 0) {
    lines.push("_No comments._", "");
  }

  for (const comment of comments) {
    lines.push(
      `### Comment by ${formatAuthor(comment.author)} on ${comment.createdAt}`,
      "",
      `URL: ${comment.url}`,
      "",
      comment.body?.trim() || "_No body._",
      "",
    );

    for (const reply of comment.replies) {
      lines.push(
        `#### Reply by ${formatAuthor(reply.author)} on ${reply.createdAt}`,
        "",
        `URL: ${reply.url}`,
        "",
        reply.body?.trim() || "_No body._",
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatAuthor(author) {
  if (!author) return "unknown";
  return author.url ? `${author.login} (${author.url})` : author.login;
}

function parseRepository(value) {
  const match = value.match(/^([^/]+)\/([^/]+)$/);

  if (!match) {
    throw new Error(`GitHub discussion source must be owner/repo: ${value}`);
  }

  return {
    owner: match[1],
    name: match[2],
  };
}

function safeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
