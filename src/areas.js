import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { areasRoot } from "./workspace.js";

export async function loadAreas() {
  const root = areasRoot();
  const files = await findYamlFiles(root);
  if (files.length === 0) throw new Error(`No area files found in ${root}`);

  const collectionNames = new Set(
    (await findYamlFiles(path.join(path.dirname(root), "collections"))).map((file) =>
      path.basename(file, path.extname(file)),
    ),
  );
  const areas = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const data = YAML.parse(raw);
    areas.push(normalizeArea(data, file, collectionNames));
  }

  return areas;
}

function normalizeArea(data, file, collectionNames) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Area file must contain a YAML object: ${file}`);
  }

  for (const field of Object.keys(data)) {
    if (!["description", "collections"].includes(field)) {
      throw new Error(`Unknown area field "${field}": ${file}`);
    }
  }

  const name = path.basename(file, path.extname(file));
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Area filename must contain only letters, numbers, hyphens, and underscores: ${file}`);
  }

  const description = expectString(data.description, "description", file);
  if (!Array.isArray(data.collections) || data.collections.length === 0) {
    throw new Error(`Area field "collections" must be a non-empty list: ${file}`);
  }

  const collections = data.collections.map((collection) =>
    expectString(collection, "collections", file),
  );
  if (new Set(collections).size !== collections.length) {
    throw new Error(`Area field "collections" must not contain duplicates: ${file}`);
  }

  const unknown = collections.find((collection) => !collectionNames.has(collection));
  if (unknown) throw new Error(`Area references unknown collection "${unknown}": ${file}`);

  return { name, description, collections };
}

async function findYamlFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function expectString(value, field, file) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Area field "${field}" must be a non-empty string: ${file}`);
  }
  return value.trim();
}
