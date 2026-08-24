import type { Collection, CollectionConfig } from "./types.ts";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function defineCollection(
  config: CollectionConfig,
  materialize: Collection["materialize"],
): Collection {
  const normalized = {
    name: requiredString(config.name, "name"),
    context: requiredString(config.context, "context"),
  };
  if (!NAME_PATTERN.test(normalized.name)) {
    throw new Error(
      "Collection name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores",
    );
  }

  return {
    ...normalized,
    materialize,
  };
}

export function validateCollection(value: unknown, location: string): Collection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Collection must be an object: ${location}`);
  }

  const record = value as Record<string, unknown>;
  const fields = Object.keys(record);
  const unknown = fields.find((field) => !["name", "context", "materialize"].includes(field));
  if (unknown) throw new Error(`Unknown collection field "${unknown}": ${location}`);

  const name = requiredString(record.name, "name", location);
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Collection name must start with a letter or number and contain only letters, numbers, dots, hyphens, and underscores: ${location}`,
    );
  }
  if (typeof record.materialize !== "function") {
    throw new Error(`Collection field "materialize" must be a function: ${location}`);
  }

  return {
    name,
    context: requiredString(record.context, "context", location),
    materialize: record.materialize as (destination: string) => Promise<void>,
  };
}

function requiredString(value: unknown, field: string, location?: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Collection field "${field}" must be a non-empty string${location ? `: ${location}` : ""}`,
    );
  }
  return value.trim();
}
