import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { collectionsRoot, materializedRoot, qmdConfigPath } from "./workspace.js";

export async function loadCollections() {
  const root = collectionsRoot();
  const files = await findYamlFiles(root);
  if (files.length === 0) {
    throw new Error(`No collection files found in ${root}`);
  }
  const collections = [];
  const destinations = materializedRoot();

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const data = YAML.parse(raw);
    collections.push(normalizeCollection(data, file, destinations));
  }

  return collections;
}

export async function writeQmdConfig(collections) {
  const config = {
    collections: Object.fromEntries(
      collections.map((collection) => [
        collection.name,
        {
          path: collection.destination,
          pattern: collection.pattern,
          context: { "/": collection.context },
        },
      ]),
    ),
  };

  const configPath = qmdConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, YAML.stringify(config, { indent: 2, lineWidth: 0 }));
  return configPath;
}

function normalizeCollection(data, file, destinations) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Collection file must contain a YAML object: ${file}`);
  }

  for (const field of Object.keys(data)) {
    if (!["source", "context", "pattern"].includes(field)) {
      throw new Error(`Unknown collection field "${field}": ${file}`);
    }
  }

  const name = path.basename(file, path.extname(file));
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Collection filename must contain only letters, numbers, hyphens, and underscores: ${file}`);
  }

  const source = expectString(data.source, "source", file);
  const separator = source.indexOf(":");
  const scheme = source.slice(0, separator);
  const sourceValue = source.slice(separator + 1).trim();
  if (separator <= 0 || !/^[a-z][a-z0-9-]*$/.test(scheme) || sourceValue === "") {
    throw new Error(`Collection field "source" must be <scheme>:<value> using a lowercase scheme: ${file}`);
  }

  return {
    name,
    source,
    scheme,
    sourceValue,
    context: expectString(data.context, "context", file),
    pattern: expectString(data.pattern, "pattern", file),
    destination: path.join(destinations, name),
  };
}

async function findYamlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function expectString(value, field, file) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Collection field "${field}" must be a non-empty string: ${file}`);
  }
  return value.trim();
}
