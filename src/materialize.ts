import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { OkfDocument, OkfFrontmatter } from "./types.ts";

const FRONTMATTER_FIELDS = ["context", "resource", "title", "type", "updated_at"];

export async function materializeOkfDocuments(
  documents: AsyncIterable<OkfDocument>,
  destination: string,
): Promise<void> {
  const paths = new Set<string>();
  for await (const document of documents) {
    const relativePath = validateDocument(document);
    if (paths.has(relativePath)) throw new Error(`connector emitted duplicate path: ${relativePath}`);
    paths.add(relativePath);

    const output = path.join(destination, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, renderOkf(document.frontmatter, document.body));
  }
}

function validateDocument(document: OkfDocument): string {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("connector emitted an invalid document");
  }
  if (typeof document.path !== "string" || document.path === "" || document.path.includes("\\")) {
    throw new Error("connector document path must be a non-empty POSIX path");
  }
  const normalized = path.posix.normalize(document.path);
  if (
    normalized !== document.path
    || path.posix.isAbsolute(normalized)
    || normalized === ".."
    || normalized.startsWith("../")
  ) {
    throw new Error(`connector document path must be normalized and relative: ${document.path}`);
  }
  if (!normalized.endsWith(".md")) {
    throw new Error(`connector document path must end in .md: ${document.path}`);
  }
  validateFrontmatter(document.frontmatter, document.path);
  if (typeof document.body !== "string") {
    throw new Error(`connector document body must be Markdown: ${document.path}`);
  }
  return normalized;
}

function validateFrontmatter(frontmatter: OkfFrontmatter, documentPath: string): void {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error(`connector document frontmatter must be an object: ${documentPath}`);
  }
  const fields = Object.keys(frontmatter).sort();
  if (
    fields.length !== FRONTMATTER_FIELDS.length
    || fields.some((field, index) => field !== FRONTMATTER_FIELDS[index])
  ) {
    throw new Error(
      `connector document frontmatter must contain exactly type, title, context, resource, and updated_at: ${documentPath}`,
    );
  }
  for (const field of FRONTMATTER_FIELDS) {
    const value = frontmatter[field as keyof OkfFrontmatter];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`connector document frontmatter requires ${field}: ${documentPath}`);
    }
  }
  if (Number.isNaN(Date.parse(frontmatter.updated_at))) {
    throw new Error(`connector document frontmatter updated_at must be a timestamp: ${documentPath}`);
  }
}

function renderOkf(frontmatter: OkfFrontmatter, body: string): string {
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${body.trimEnd()}\n`;
}
