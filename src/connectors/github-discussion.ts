import { materializeOkfDocuments } from "../materialize.ts";
import { defineCollection } from "../collection.ts";
import type { Collection, CollectionConfig, OkfDocument } from "../types.ts";

const MAX_GRAPHQL_ATTEMPTS = 6;

type Author = { login: string; url?: string } | null;
type Reply = { body?: string; url: string; createdAt: string; author: Author };
type DiscussionComment = Reply & {
  id: string;
  replies: { pageInfo: PageInfo; nodes: Reply[] };
};
type Discussion = {
  id: string;
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  body?: string;
  author: Author;
  category?: { name?: string };
};
type PageInfo = { hasNextPage: boolean; endCursor?: string | null };

export type GitHubDiscussionOptions = CollectionConfig & {
  repository: string;
};

type ClientOptions = {
  token?: string;
  apiUrl?: string;
};

export function githubDiscussion(options: GitHubDiscussionOptions): Collection {
  const config = normalizeOptions(options, "GitHub discussion collection");
  return defineCollection(
    config,
    (destination) => materializeOkfDocuments(generateDocuments(config), destination),
  );
}

export function githubDiscussionDocuments(
  collection: GitHubDiscussionOptions,
  options: ClientOptions = {},
): AsyncGenerator<OkfDocument> {
  return generateDocuments(normalizeOptions(collection, collection.name), options);
}

async function* generateDocuments(
  config: GitHubDiscussionOptions,
  options: ClientOptions = {},
): AsyncGenerator<OkfDocument> {
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GitHub Discussions authentication requires GITHUB_TOKEN or GH_TOKEN");
  }
  const client = new GraphqlClient(token, options.apiUrl);
  const repository = parseRepository(config.repository);
  const discussions = await fetchDiscussions(client, repository);

  for (const [index, discussion] of discussions.entries()) {
    const comments = await fetchComments(client, discussion.id);
    yield toOkfDocument(config, discussion, comments);
    const count = index + 1;
    if (count === discussions.length || count % 25 === 0) {
      process.stderr.write(`Exported ${count}/${discussions.length} discussion files\n`);
    }
  }
}

async function fetchDiscussions(
  client: GraphqlClient,
  repository: { owner: string; name: string },
): Promise<Discussion[]> {
  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        discussions(first: 50, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id number title url createdAt updatedAt body
            author { login url }
            category { name }
          }
        }
      }
    }
  `;
  const discussions: Discussion[] = [];
  let cursor: string | undefined;
  do {
    const data = await client.request<{
      repository: {
        discussions: {
          totalCount: number;
          pageInfo: PageInfo;
          nodes: Discussion[];
        };
      };
    }>(query, { owner: repository.owner, name: repository.name, cursor });
    const page = data.repository.discussions;
    discussions.push(...page.nodes);
    cursor = nextCursor(page.pageInfo, "discussions");
    process.stderr.write(`Fetched ${discussions.length}/${page.totalCount} discussions\n`);
  } while (cursor);
  return discussions.toSorted((left, right) => left.number - right.number);
}

async function fetchComments(
  client: GraphqlClient,
  discussionId: string,
): Promise<(Omit<DiscussionComment, "replies"> & { replies: Reply[] })[]> {
  const query = `
    query($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on Discussion {
          comments(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id body url createdAt author { login url }
              replies(first: 100) {
                pageInfo { hasNextPage endCursor }
                nodes { body url createdAt author { login url } }
              }
            }
          }
        }
      }
    }
  `;
  const comments: (Omit<DiscussionComment, "replies"> & { replies: Reply[] })[] = [];
  let cursor: string | undefined;
  do {
    const data = await client.request<{
      node: { comments: { pageInfo: PageInfo; nodes: DiscussionComment[] } };
    }>(query, { id: discussionId, cursor });
    const page = data.node.comments;
    for (const comment of page.nodes) {
      comments.push({ ...comment, replies: await fetchRemainingReplies(client, comment) });
    }
    cursor = nextCursor(page.pageInfo, "discussion comments");
  } while (cursor);
  return comments;
}

async function fetchRemainingReplies(
  client: GraphqlClient,
  comment: DiscussionComment,
): Promise<Reply[]> {
  const replies = [...comment.replies.nodes];
  let cursor = nextCursor(comment.replies.pageInfo, "discussion replies");
  if (!cursor) return replies;

  const query = `
    query($id: ID!, $cursor: String) {
      node(id: $id) {
        ... on DiscussionComment {
          replies(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { body url createdAt author { login url } }
          }
        }
      }
    }
  `;
  do {
    const data = await client.request<{
      node: { replies: { pageInfo: PageInfo; nodes: Reply[] } };
    }>(query, { id: comment.id, cursor });
    replies.push(...data.node.replies.nodes);
    cursor = nextCursor(data.node.replies.pageInfo, "discussion replies");
  } while (cursor);
  return replies;
}

class GraphqlClient {
  readonly #token: string;
  readonly #apiUrl: string;

  constructor(token: string, apiUrl = "https://api.github.com/graphql") {
    this.#token = token;
    this.#apiUrl = apiUrl;
  }

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_GRAPHQL_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(this.#apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.#token}`,
            "content-type": "application/json",
            "user-agent": "filoscope-github-discussion-connector",
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(120_000),
        });
        const body = await response.text();
        if (!response.ok) {
          const message = `${response.status} ${response.statusText}: ${body}`;
          if (!isRetryable(message) || attempt === MAX_GRAPHQL_ATTEMPTS) {
            throw new Error(`GitHub GraphQL request failed: ${message}`);
          }
          await waitForRetry(attempt, message);
          continue;
        }
        const parsed = JSON.parse(body) as { data?: T; errors?: { message?: string }[] };
        if (parsed.errors?.length) {
          const message = parsed.errors.map((error) => error.message ?? "Unknown error").join("\n");
          if (!isRetryable(message) || attempt === MAX_GRAPHQL_ATTEMPTS) {
            throw new Error(`GitHub GraphQL request failed: ${message}`);
          }
          await waitForRetry(attempt, message);
          continue;
        }
        if (parsed.data === undefined) throw new Error("GitHub GraphQL response contains no data");
        return parsed.data;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isRetryable(message) || attempt === MAX_GRAPHQL_ATTEMPTS) throw error;
        await waitForRetry(attempt, message);
      }
    }
    throw new Error("GitHub GraphQL retry loop ended unexpectedly");
  }
}

function toOkfDocument(
  collection: GitHubDiscussionOptions,
  discussion: Discussion,
  comments: (Omit<DiscussionComment, "replies"> & { replies: Reply[] })[],
): OkfDocument {
  const prefix = String(discussion.number).padStart(4, "0");
  const title = safeFileName(discussion.title) || "discussion";
  return {
    path: `${prefix}-${title}.md`,
    frontmatter: {
      type: "Conversation",
      title: `#${discussion.number} ${discussion.title}`,
      context: collection.context,
      resource: discussion.url,
      updated_at: discussion.updatedAt,
    },
    body: renderDiscussion(discussion, comments),
  };
}

function renderDiscussion(
  discussion: Discussion,
  comments: (Omit<DiscussionComment, "replies"> & { replies: Reply[] })[],
): string {
  const lines = [
    `# #${discussion.number} ${discussion.title}`,
    "",
    `Category: ${discussion.category?.name ?? "Uncategorized"}`,
    `Author: ${formatAuthor(discussion.author)}`,
    `Created: ${discussion.createdAt}`,
    "",
    discussion.body?.trim() || "_No body._",
    "",
    "## Comments",
    "",
  ];
  if (comments.length === 0) lines.push("_No comments._", "");
  for (const comment of comments) {
    lines.push(
      `### ${formatAuthor(comment.author)} on ${comment.createdAt}`,
      "",
      `[Canonical comment](${comment.url})`,
      "",
      comment.body?.trim() || "_No body._",
      "",
    );
    for (const reply of comment.replies) {
      lines.push(
        `#### ${formatAuthor(reply.author)} on ${reply.createdAt}`,
        "",
        `[Canonical reply](${reply.url})`,
        "",
        reply.body?.trim() || "_No body._",
        "",
      );
    }
  }
  return lines.join("\n").trimEnd();
}

function normalizeOptions(
  collection: GitHubDiscussionOptions,
  location: string,
): GitHubDiscussionOptions {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error(`GitHub discussion collection must be an object: ${location}`);
  }
  const fields = new Set(["name", "context", "repository"]);
  for (const field of Object.keys(collection)) {
    if (!fields.has(field)) {
      throw new Error(`Unknown GitHub discussion collection field "${field}": ${location}`);
    }
  }
  return { ...collection, repository: formatRepository(collection.repository, location) };
}

function formatRepository(value: unknown, location: string): string {
  if (typeof value !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(value.trim())) {
    throw new Error(
      `GitHub discussion collection field "repository" must be owner/repo: ${location}`,
    );
  }
  return value.trim();
}

function parseRepository(value: string): { owner: string; name: string } {
  const [owner, name] = value.split("/");
  return { owner: owner!, name: name! };
}

function nextCursor(pageInfo: PageInfo, context: string): string | undefined {
  if (!pageInfo.hasNextPage) return undefined;
  if (!pageInfo.endCursor) throw new Error(`GitHub GraphQL ${context} page has no end cursor`);
  return pageInfo.endCursor;
}

function formatAuthor(author: Author): string {
  if (!author) return "unknown";
  return author.url ? `[${author.login}](${author.url})` : author.login;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[. -]+$/g, "")
    .slice(0, 120);
}

function isRetryable(message: string): boolean {
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|502|503|504|rate limit|secondary rate/i.test(message);
}

async function waitForRetry(attempt: number, message: string): Promise<void> {
  const delay = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
  process.stderr.write(
    `GitHub GraphQL request failed (${message.trim()}); retrying in ${Math.round(delay / 1000)}s\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}
