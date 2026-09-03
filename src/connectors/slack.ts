import { LogLevel, WebClient } from "@slack/web-api";
import { materializeOkfDocuments } from "../materialize.ts";
import { defineCollection } from "../collection.ts";
import type { Collection, CollectionConfig, OkfDocument } from "../types.ts";

const PAGE_SIZE = 200;

type SlackMessage = {
  ts?: string;
  thread_ts?: string;
  latest_reply?: string;
  reply_count?: number;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  bot_profile?: { name?: string };
  edited?: { ts?: string };
  reactions?: { name?: string; count?: number }[];
  files?: { id?: string; name?: string; title?: string; permalink?: string }[];
  attachments?: { title?: string; title_link?: string; text?: string; fallback?: string }[];
};

type SlackUser = {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
};

export type SlackOptions = CollectionConfig & {
  channelId: string;
};

type SlackClientOptions = {
  token?: string;
  apiBase?: string;
};

export function slack(options: SlackOptions): Collection {
  const config = normalizeSlackOptions(options, "Slack collection");
  return defineCollection(
    config,
    (destination) => materializeOkfDocuments(generateDocuments(config), destination),
  );
}

export function slackDocuments(
  collection: SlackOptions,
  options: SlackClientOptions = {},
): AsyncGenerator<OkfDocument> {
  return generateDocuments(normalizeSlackOptions(collection, collection.name), options);
}

async function* generateDocuments(
  config: SlackOptions,
  options: SlackClientOptions = {},
): AsyncGenerator<OkfDocument> {
  const token = options.token ?? process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack authentication requires SLACK_BOT_TOKEN");

  const client = new WebClient(token, {
    logLevel: LogLevel.ERROR,
    maxRequestConcurrency: 1,
    slackApiUrl: options.apiBase ? `${options.apiBase.replace(/\/$/, "")}/` : undefined,
  });
  const [workspaceUrl, users, roots] = await Promise.all([
    getWorkspaceUrl(client),
    listUsers(client),
    listHistory(client, config.channelId),
  ]);

  for (const root of roots) {
    const hasReplies = (root.reply_count ?? 0) > 0 || root.latest_reply !== undefined;
    const messages = hasReplies ? await listThread(client, config.channelId, root) : [root];
    yield toOkfDocument(config, workspaceUrl, messages, users);
  }
}

function normalizeSlackOptions(collection: SlackOptions, location: string): SlackOptions {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error(`Slack collection must be an object: ${location}`);
  }
  const fields = new Set(["name", "context", "channelId"]);
  for (const field of Object.keys(collection)) {
    if (!fields.has(field)) throw new Error(`Unknown Slack collection field "${field}": ${location}`);
  }
  if (typeof collection.channelId !== "string" || collection.channelId.trim() === "") {
    throw new Error(`Slack collection field "channelId" must be a non-empty string: ${location}`);
  }
  return { ...collection, channelId: collection.channelId.trim() };
}

async function getWorkspaceUrl(client: WebClient): Promise<string> {
  const response = await client.auth.test();
  if (!response.url) throw new Error("Slack auth.test returned no workspace URL");
  return response.url.replace(/\/$/, "");
}

async function listUsers(client: WebClient): Promise<Map<string, string>> {
  const users = new Map<string, string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await client.users.list({ cursor, limit: PAGE_SIZE });
    for (const user of response.members ?? [] as SlackUser[]) {
      if (!user.id) throw new Error("Slack users.list returned a user without an ID");
      const name = user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || user.id;
      users.set(user.id, name);
    }
    cursor = response.response_metadata?.next_cursor || undefined;
    assertNewCursor(cursor, seenCursors, "users.list");
  } while (cursor);

  return users;
}

async function listHistory(client: WebClient, channelId: string): Promise<SlackMessage[]> {
  const messages = new Map<string, SlackMessage>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await client.conversations.history({ channel: channelId, cursor, limit: PAGE_SIZE });
    for (const message of response.messages ?? [] as SlackMessage[]) {
      const timestamp = requireTimestamp(message, "conversations.history");
      if (message.thread_ts && message.thread_ts !== timestamp) continue;
      messages.set(timestamp, message);
    }
    cursor = response.response_metadata?.next_cursor || undefined;
    assertNewCursor(cursor, seenCursors, "conversations.history");
  } while (cursor);

  return [...messages.values()].toSorted(compareMessages);
}

async function listThread(client: WebClient, channelId: string, root: SlackMessage): Promise<SlackMessage[]> {
  const rootTimestamp = requireTimestamp(root, "thread root");
  const messages = new Map([[rootTimestamp, root]]);
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: rootTimestamp,
      cursor,
      limit: PAGE_SIZE,
    });
    for (const message of response.messages ?? [] as SlackMessage[]) {
      messages.set(requireTimestamp(message, "conversations.replies"), message);
    }
    cursor = response.response_metadata?.next_cursor || undefined;
    assertNewCursor(cursor, seenCursors, "conversations.replies");
  } while (cursor);

  return [...messages.values()].toSorted(compareMessages);
}

function assertNewCursor(cursor: string | undefined, seen: Set<string>, method: string): void {
  if (!cursor) return;
  if (seen.has(cursor)) throw new Error(`Slack ${method} returned a repeated pagination cursor`);
  seen.add(cursor);
}

function toOkfDocument(
  source: SlackOptions,
  workspaceUrl: string,
  messages: SlackMessage[],
  users: Map<string, string>,
): OkfDocument {
  const root = messages[0];
  if (!root) throw new Error("Cannot render an empty Slack conversation");
  const timestamp = requireTimestamp(root, "thread root");
  const startedAt = timestampToIso(timestamp);
  const author = authorName(root, users);
  const title = messageTitle(root, author, users);
  const resource = `${workspaceUrl}/archives/${encodeURIComponent(source.channelId)}/p${timestamp.replace(".", "")}`;

  return {
    path: `${startedAt.slice(0, 10)}/${timestamp.replace(".", "-")}.md`,
    frontmatter: {
      type: "Conversation",
      title,
      context: source.context,
      resource,
      updated_at: latestMessageTime(messages),
    },
    body: renderConversation(source.channelId, messages, users),
  };
}

function renderConversation(channelId: string, messages: SlackMessage[], users: Map<string, string>): string {
  const rootTimestamp = requireTimestamp(messages[0]!, "thread root");
  const lines = [
    "# Slack conversation",
    "",
    `- **Channel:** \`${channelId}\``,
    `- **Started:** \`${timestampToIso(rootTimestamp)}\``,
    `- **Messages:** ${messages.length}`,
  ];

  for (const message of messages) {
    const timestamp = requireTimestamp(message, "message");
    lines.push("", `## ${authorName(message, users)} — ${timestampToIso(timestamp)}`, "");
    const text = slackMrkdwnToMarkdown(message.text ?? "", users).trim();
    if (text) lines.push(text);

    const attachments = renderAttachments(message.attachments ?? [], users);
    if (attachments) lines.push(text ? "" : "", attachments);

    if (message.files?.length) {
      lines.push(text || attachments ? "" : "", "**Files**", "");
      for (const file of message.files) {
        const label = file.title || file.name || file.id || "Slack file";
        lines.push(file.permalink ? `- [${label}](${file.permalink})` : `- ${label}`);
      }
    }

    if (message.reactions?.length) {
      const reactions = message.reactions.map((reaction) => {
        const name = reaction.name ? `:${reaction.name}:` : ":unknown:";
        return `${name} × ${reaction.count ?? 0}`;
      });
      lines.push("", `**Reactions:** ${reactions.join(", ")}`);
    }

    if (!text && !attachments && !message.files?.length) lines.push("_No text content._");
    if (message.edited?.ts) lines.push("", `_Edited ${timestampToIso(message.edited.ts)}_`);
  }

  return lines.join("\n");
}

function renderAttachments(
  attachments: NonNullable<SlackMessage["attachments"]>,
  users: Map<string, string>,
): string {
  const rendered = attachments.flatMap((attachment) => {
    const title = attachment.title?.trim();
    const text = slackMrkdwnToMarkdown(attachment.text ?? attachment.fallback ?? "", users).trim();
    if (!title && !text) return [];
    const heading = title
      ? attachment.title_link ? `[${title}](${attachment.title_link})` : title
      : undefined;
    return [["**Attachment**", heading, text].filter(Boolean).join("\n\n")];
  });
  return rendered.join("\n\n");
}

function slackMrkdwnToMarkdown(value: string, users: Map<string, string>): string {
  return value
    .replace(/<([^<>\n]+)>/g, (_match, token: string) => renderSlackToken(token, users))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s.,!?;:)\]}])/gm, "$1**$2**")
    .replace(/(^|[\s([{])~([^~\n]+)~(?=$|[\s.,!?;:)\]}])/gm, "$1~~$2~~");
}

function renderSlackToken(token: string, users: Map<string, string>): string {
  const user = token.match(/^@([^|]+)(?:\|.*)?$/);
  if (user) return `@${users.get(user[1]!) ?? user[1]}`;

  const channel = token.match(/^#([^|]+)(?:\|(.+))?$/);
  if (channel) return `#${channel[2] ?? channel[1]}`;

  if (token.startsWith("!date^")) return token.includes("|") ? token.slice(token.lastIndexOf("|") + 1) : token;
  const group = token.match(/^!subteam\^([^|]+)(?:\|@?(.+))?$/);
  if (group) return `@${group[2] ?? group[1]}`;
  if (token.startsWith("!")) return `@${token.slice(1).split("^")[0]}`;

  const separator = token.indexOf("|");
  if (separator === -1) return token;
  const url = token.slice(0, separator);
  const label = token.slice(separator + 1);
  return `[${label}](${url})`;
}

function messageTitle(message: SlackMessage, author: string, users: Map<string, string>): string {
  const text = slackMrkdwnToMarkdown(message.text ?? "", users)
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*~`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary = text.length > 100 ? `${text.slice(0, 97).trimEnd()}…` : text;
  return summary ? `${author}: ${summary}` : `Slack message from ${author}`;
}

function authorName(message: SlackMessage, users: Map<string, string>): string {
  if (message.user) return users.get(message.user) ?? message.user;
  return message.bot_profile?.name || message.username || message.bot_id || "Unknown author";
}

function latestMessageTime(messages: SlackMessage[]): string {
  let latest = 0;
  for (const message of messages) {
    for (const value of [requireTimestamp(message, "message"), message.edited?.ts]) {
      if (!value) continue;
      const timestamp = parseTimestamp(value);
      if (timestamp > latest) latest = timestamp;
    }
  }
  return new Date(latest * 1000).toISOString();
}

function requireTimestamp(message: SlackMessage, context: string): string {
  if (!message.ts) throw new Error(`Slack ${context} has no timestamp`);
  parseTimestamp(message.ts);
  return message.ts;
}

function timestampToIso(value: string): string {
  return new Date(parseTimestamp(value) * 1000).toISOString();
}

function parseTimestamp(value: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid Slack timestamp: ${value}`);
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error(`Invalid Slack timestamp: ${value}`);
  return timestamp;
}

function compareMessages(left: SlackMessage, right: SlackMessage): number {
  return requireTimestamp(left, "message").localeCompare(requireTimestamp(right, "message"));
}
