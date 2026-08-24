import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { defineCollection } from "../collection.ts";
import type { Collection, CollectionConfig } from "../types.ts";

export type GitHubOptions = CollectionConfig & {
  repository: string;
  include?: string;
};

type MaterializeOptions = {
  token?: string;
  apiBase?: string;
};

export function github(options: GitHubOptions): Collection {
  const config = normalizeGitHubOptions(options, "GitHub collection");
  return defineCollection(config, (destination) => materializeGitHub(config, destination));
}

export async function githubMaterialize(
  collection: GitHubOptions,
  destination: string,
  options: MaterializeOptions = {},
): Promise<void> {
  await materializeGitHub(
    normalizeGitHubOptions(collection, collection.name),
    destination,
    options,
  );
}

async function materializeGitHub(
  collection: GitHubOptions,
  destination: string,
  options: MaterializeOptions = {},
): Promise<void> {
  const [owner, repository] = collection.repository.split("/");
  const apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const response = await fetch(
    `${apiBase}/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repository!)}/tarball`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "filoscope-github-connector",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500).trim();
    throw new Error(
      `GitHub archive download failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
    );
  }
  if (!response.body) throw new Error("GitHub archive download returned an empty body");

  await pipeline(
    Readable.from(response.body),
    tar.x({
      cwd: destination,
      strip: 1,
      filter: collection.include
        ? (archivePath) => path.matchesGlob(withoutArchiveRoot(archivePath), collection.include!)
        : undefined,
    }),
  );
}

function normalizeGitHubOptions(collection: GitHubOptions, location: string): GitHubOptions {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new Error(`GitHub collection must be an object: ${location}`);
  }
  const fields = new Set(["name", "context", "repository", "include"]);
  for (const field of Object.keys(collection)) {
    if (!fields.has(field)) throw new Error(`Unknown GitHub collection field "${field}": ${location}`);
  }
  if (
    typeof collection.repository !== "string"
    || !/^[^/\s]+\/[^/\s]+$/.test(collection.repository.trim())
  ) {
    throw new Error(`GitHub collection field "repository" must be owner/repo: ${location}`);
  }
  const repository = collection.repository.trim();
  let include = collection.include;
  if (include !== undefined) {
    if (typeof include !== "string" || include.trim() === "") {
      throw new Error(`GitHub collection field "include" must be a non-empty glob: ${location}`);
    }
    include = include.trim();
    try {
      path.matchesGlob("file", include);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `GitHub collection field "include" is not a valid glob: ${location}: ${message}`,
      );
    }
  }
  return { ...collection, repository, ...(include ? { include } : {}) };
}

function withoutArchiveRoot(archivePath: string): string {
  const separator = archivePath.indexOf("/");
  return separator === -1 ? "" : archivePath.slice(separator + 1);
}
