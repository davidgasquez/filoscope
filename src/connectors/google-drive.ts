import path from "node:path";
import { GoogleAuth } from "google-auth-library";
import { materializeOkfDocuments } from "../materialize.ts";
import { defineCollection } from "../collection.ts";
import type { Collection, CollectionConfig, OkfDocument } from "../types.ts";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const PDF_MIME = "application/pdf";
const EXPORT_MIME = new Map([
  ["application/vnd.google-apps.document", "text/markdown"],
  ["application/vnd.google-apps.spreadsheet", "text/csv"],
  ["application/vnd.google-apps.presentation", "text/plain"],
]);

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
};

type DriveReply = {
  id: string;
  author?: { displayName?: string };
  content?: string;
  createdTime: string;
  modifiedTime?: string;
  action?: string;
};

type DriveComment = {
  id: string;
  author?: { displayName?: string };
  content?: string;
  quotedFileContent?: { value?: string };
  createdTime: string;
  modifiedTime?: string;
  resolved?: boolean;
  replies?: DriveReply[];
};

type CommentReply = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  modifiedAt: string;
  action?: string;
};

type CommentThread = {
  id: string;
  author: string;
  content: string;
  quotedContent?: string;
  createdAt: string;
  modifiedAt: string;
  resolved: boolean;
  replies: CommentReply[];
};

type GoogleDriveDocument = {
  context: string;
  title: string;
  resource: string;
  updatedAt: string;
  body: string;
  comments: CommentThread[];
};

export type GoogleDriveOptions = CollectionConfig & (
  | { folderId: string; fileId?: never }
  | { fileId: string; folderId?: never }
);

type GoogleDriveClientOptions = {
  accessToken?: string;
  apiBase?: string;
};

export function googleDrive(options: GoogleDriveOptions): Collection {
  const config = normalizeGoogleDriveOptions(options, "Google Drive collection");
  return defineCollection(
    config,
    (destination) => materializeOkfDocuments(generateDocuments(config), destination),
  );
}

export function googleDriveDocuments(
  collection: GoogleDriveOptions,
  options: GoogleDriveClientOptions = {},
): AsyncGenerator<OkfDocument> {
  return generateDocuments(normalizeGoogleDriveOptions(collection, collection.name), options);
}

async function* generateDocuments(
  config: GoogleDriveOptions,
  options: GoogleDriveClientOptions = {},
): AsyncGenerator<OkfDocument> {
  const token = options.accessToken ?? await getAccessToken();
  const drive = new DriveClient(token, options.apiBase);
  const textDecoder = new TextDecoder("utf-8", { fatal: true });

  async function readFile(file: DriveFile, targetParents: string[]): Promise<OkfDocument> {
    const outputName = `${safeSegment(file.name)}--${safeSegment(file.id)}.md`;
    const outputPath = path.posix.join(...targetParents, outputName);
    const resource = file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
    let body: string;
    let comments: CommentThread[];

    if (file.mimeType === SHORTCUT_MIME) {
      body = `[Open the Google Drive shortcut](${resource})`;
      comments = [];
    } else {
      const [content, fileComments] = await Promise.all([
        drive.download(file),
        drive.listComments(file.id),
      ]);
      body = await extractBody(file, content, textDecoder);
      comments = fileComments;
    }

    return toOkfDocument(outputPath, {
      context: config.context,
      title: file.name,
      resource,
      updatedAt: file.modifiedTime,
      body,
      comments,
    });
  }

  async function* walk(folderId: string, targetParents: string[]): AsyncGenerator<OkfDocument> {
    const children = await drive.listChildren(folderId);
    const folders = children.filter((child) => child.mimeType === FOLDER_MIME);
    const folderNameCounts = new Map<string, number>();
    for (const folder of folders) {
      const segment = safeSegment(folder.name);
      folderNameCounts.set(segment, (folderNameCounts.get(segment) ?? 0) + 1);
    }

    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        const base = safeSegment(child.name);
        const segment = folderNameCounts.get(base)! > 1 ? `${base}--${safeSegment(child.id)}` : base;
        yield* walk(child.id, [...targetParents, segment]);
      } else {
        yield await readFile(child, targetParents);
      }
    }
  }

  if (config.folderId !== undefined) {
    yield* walk(config.folderId, []);
  } else {
    const file = await drive.getFile(config.fileId);
    if (file.mimeType === FOLDER_MIME) throw new Error(`Configured Drive file is a folder; use folderId: ${file.id}`);
    yield await readFile(file, []);
  }
}

function normalizeGoogleDriveOptions(
  collection: GoogleDriveOptions,
  location: string,
): GoogleDriveOptions {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error(`Google Drive collection must be an object: ${location}`);
  }
  const fields = new Set(["name", "context", "folderId", "fileId"]);
  for (const field of Object.keys(collection)) {
    if (!fields.has(field)) throw new Error(`Unknown Google Drive collection field "${field}": ${location}`);
  }
  const folderId = optionalString(collection.folderId, "folderId", location);
  const fileId = optionalString(collection.fileId, "fileId", location);
  if ((folderId === undefined) === (fileId === undefined)) {
    throw new Error(`Google Drive collection must define exactly one of "folderId" or "fileId": ${location}`);
  }
  const { folderId: _folderId, fileId: _fileId, ...common } = collection as CollectionConfig & {
    folderId?: string;
    fileId?: string;
  };
  return folderId === undefined
    ? { ...common, fileId: fileId! }
    : { ...common, folderId };
}

function optionalString(value: unknown, field: string, location: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Google Drive collection field "${field}" must be a non-empty string: ${location}`);
  }
  return value.trim();
}

async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({ scopes: [DRIVE_SCOPE] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Google authentication returned no access token");
  return token;
}

async function extractBody(file: DriveFile, content: Uint8Array, decoder: TextDecoder): Promise<string> {
  if (file.mimeType === PDF_MIME) {
    const { extractBytes } = await import("@kreuzberg/node");
    return (await extractBytes(content, PDF_MIME, { outputFormat: "markdown" })).content;
  }

  try {
    return decoder.decode(content);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Cannot represent non-UTF-8 Google Drive file as Markdown: ${file.name}`);
    }
    throw error;
  }
}

class DriveClient {
  readonly #apiBase: string;
  readonly #headers: HeadersInit;

  constructor(accessToken: string, apiBase = "https://www.googleapis.com/drive/v3") {
    this.#apiBase = apiBase.replace(/\/$/, "");
    this.#headers = { authorization: `Bearer ${accessToken}`, "user-agent": "filoscope" };
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const query = new URLSearchParams({
      fields: "id,name,mimeType,modifiedTime,webViewLink",
      supportsAllDrives: "true",
    });
    return this.#json<DriveFile>(`/files/${encodeURIComponent(fileId)}?${query}`);
  }

  async listChildren(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const query = new URLSearchParams({
        q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
        includeItemsFromAllDrives: "true",
        orderBy: "name_natural",
        pageSize: "1000",
        supportsAllDrives: "true",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.#json<{ nextPageToken?: string; files?: DriveFile[] }>(`/files?${query}`);
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return files.toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  async download(file: DriveFile): Promise<Uint8Array> {
    const exportMime = EXPORT_MIME.get(file.mimeType);
    const route = exportMime
      ? `/files/${encodeURIComponent(file.id)}/export?${new URLSearchParams({ mimeType: exportMime })}`
      : `/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
    return new Uint8Array(await (await this.#request(route)).arrayBuffer());
  }

  async listComments(fileId: string): Promise<CommentThread[]> {
    const comments: DriveComment[] = [];
    let pageToken: string | undefined;

    do {
      const query = new URLSearchParams({
        fields: "nextPageToken,comments(id,author(displayName),content,createdTime,modifiedTime,resolved,quotedFileContent(value),replies(id,author(displayName),content,createdTime,modifiedTime,action))",
        includeDeleted: "false",
        pageSize: "100",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.#json<{ nextPageToken?: string; comments?: DriveComment[] }>(
        `/files/${encodeURIComponent(fileId)}/comments?${query}`,
      );
      comments.push(...(page.comments ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return comments.map(normalizeComment).toSorted(compareCreated);
  }

  async #json<T>(route: string): Promise<T> {
    return await (await this.#request(route)).json() as T;
  }

  async #request(route: string): Promise<Response> {
    const response = await fetch(`${this.#apiBase}${route}`, { headers: this.#headers });
    if (response.ok) return response;
    const detail = (await response.text()).slice(0, 500).trim();
    throw new Error(
      `Google Drive request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
    );
  }
}

function toOkfDocument(outputPath: string, document: GoogleDriveDocument): OkfDocument {
  const frontmatter = {
    type: "Reference",
    title: document.title,
    context: document.context,
    resource: document.resource,
    updated_at: latestTimestamp([
      document.updatedAt,
      ...document.comments.flatMap((comment) => [
        comment.modifiedAt,
        ...comment.replies.map((reply) => reply.modifiedAt),
      ]),
    ]),
  };

  let body = document.body.trimEnd();
  if (document.comments.length > 0) {
    body += `\n\n# Comments\n\n${document.comments.map(renderComment).join("\n\n")}`;
  }
  return { path: outputPath, frontmatter, body };
}

function renderComment(comment: CommentThread): string {
  const lines = [
    `## Thread \`${comment.id}\``,
    "",
    `- **Author:** ${comment.author}`,
    `- **Created:** \`${comment.createdAt}\``,
    `- **Modified:** \`${comment.modifiedAt}\``,
    `- **Status:** ${comment.resolved ? "resolved" : "open"}`,
  ];

  if (comment.quotedContent) {
    lines.push("", "**Quoted text**", "", blockquote(comment.quotedContent));
  }
  lines.push("", "**Comment**", "", blockquote(comment.content));

  if (comment.replies.length > 0) {
    lines.push("", "### Replies");
    for (const reply of comment.replies) lines.push("", ...renderReply(reply));
  }
  return lines.join("\n");
}

function renderReply(reply: CommentReply): string[] {
  const lines = [
    `#### Reply \`${reply.id}\``,
    "",
    `- **Author:** ${reply.author}`,
    `- **Created:** \`${reply.createdAt}\``,
    `- **Modified:** \`${reply.modifiedAt}\``,
  ];
  if (reply.action) lines.push(`- **Action:** ${reply.action}`);
  lines.push("", blockquote(reply.content));
  return lines;
}

function blockquote(value: string): string {
  return value.split("\n").map((line) => (line ? `> ${line}` : "> ")).join("\n");
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) => {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) throw new Error(`Invalid source timestamp: ${value}`);
    return timestamp > Date.parse(latest) ? value : latest;
  });
}

function normalizeComment(comment: DriveComment): CommentThread {
  return {
    id: comment.id,
    author: comment.author?.displayName ?? "Unknown author",
    content: comment.content ?? "",
    quotedContent: comment.quotedFileContent?.value,
    createdAt: comment.createdTime,
    modifiedAt: comment.modifiedTime ?? comment.createdTime,
    resolved: comment.resolved ?? false,
    replies: (comment.replies ?? []).map(normalizeReply).toSorted(compareCreated),
  };
}

function normalizeReply(reply: DriveReply): CommentReply {
  return {
    id: reply.id,
    author: reply.author?.displayName ?? "Unknown author",
    content: reply.content ?? "",
    createdAt: reply.createdTime,
    modifiedAt: reply.modifiedTime ?? reply.createdTime,
    action: reply.action,
  };
}

function compareCreated<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function safeSegment(value: string): string {
  const segment = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+|[. -]+$/g, "")
    .slice(0, 120);
  return segment || "untitled";
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
