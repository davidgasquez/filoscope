import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateCollection } from "./collection.ts";
import type { Area, Collection } from "./types.ts";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export async function loadCollections(directory: string): Promise<Collection[]> {
  const files = await definitionFiles(directory, "collection");
  const collections = await Promise.all(files.map(async (file) => {
    const module = await import(pathToFileURL(path.join(directory, file)).href);
    if (Array.isArray(module.default)) {
      throw new Error(`Collection file must export exactly one definition: ${file}`);
    }
    return validateCollection(module.default, file);
  }));
  const names = new Set<string>();
  for (const collection of collections) {
    if (names.has(collection.name)) throw new Error(`Duplicate collection name: ${collection.name}`);
    names.add(collection.name);
  }
  return collections;
}

export async function loadAreas(
  directory: string,
  collections: readonly Collection[],
): Promise<Area[]> {
  const files = await definitionFiles(directory, "area");
  const discovered = new Set(collections.map((collection) => collection.name));
  const areas = await Promise.all(files.map(async (file) => {
    const module = await import(pathToFileURL(path.join(directory, file)).href);
    const area = validateArea(module.default, file);
    const unknown = area.collections.find((collection) => !discovered.has(collection));
    if (unknown) throw new Error(`Area references unknown collection "${unknown}": ${file}`);
    return area;
  }));

  const names = new Set<string>();
  for (const area of areas) {
    if (names.has(area.name)) throw new Error(`Duplicate area name: ${area.name}`);
    names.add(area.name);
  }
  return areas;
}

function validateArea(value: unknown, location: string): Area {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Area must be an object: ${location}`);
  }

  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(
    (field) => !["name", "description", "collections"].includes(field),
  );
  if (unknown) throw new Error(`Unknown area field "${unknown}": ${location}`);

  const name = requiredString(record.name, "name", location);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Area name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores: ${location}`,
    );
  }
  if (!Array.isArray(record.collections) || record.collections.length === 0) {
    throw new Error(`Area field "collections" must be a non-empty list: ${location}`);
  }
  const collections = record.collections.map((collection, index) =>
    requiredString(collection, `collections[${index}]`, location)
  );
  const duplicate = collections.find(
    (collection, index) => collections.indexOf(collection) !== index,
  );
  if (duplicate) {
    throw new Error(
      `Area field "collections" contains duplicate collection "${duplicate}": ${location}`,
    );
  }

  return {
    name,
    description: requiredString(record.description, "description", location),
    collections,
  };
}

function requiredString(value: unknown, field: string, location: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Area field "${field}" must be a non-empty string: ${location}`);
  }
  return value.trim();
}

async function definitionFiles(directory: string, kind: "collection" | "area"): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`No ${kind} directory found: ${directory}`);
    }
    throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile()
        && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))
        && !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    throw new Error(`No TypeScript or JavaScript ${kind} files found in ${directory}`);
  }
  return files;
}
