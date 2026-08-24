import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Collection } from "../types.ts";
import { qmdConfigPath } from "./paths.ts";

export type QmdConfig = {
  collections: Record<string, {
    path: string;
    pattern: string;
    context?: Record<string, string>;
    includeByDefault?: false;
  }>;
  global_context?: string;
};

export async function writeQmdConfig(
  collections: readonly Collection[],
  materializedRoot: string,
): Promise<string> {
  const config: QmdConfig = {
    collections: Object.fromEntries(
      collections.map((collection) => [
        collection.name,
        {
          path: path.join(materializedRoot, collection.name),
          pattern: "**/*",
          context: { "/": collection.context },
        },
      ]),
    ),
  };
  const destination = qmdConfigPath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, renderQmdConfig(config));
  return destination;
}

export function renderQmdConfig(config: QmdConfig): string {
  return YAML.stringify(config, { indent: 2, lineWidth: 0 });
}
