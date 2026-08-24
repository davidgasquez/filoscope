import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const bundledDefinitionsRoot = path.dirname(moduleDirectory);

export type Workspace = {
  root: string;
  collectionsDirectory: string;
  areasDirectory: string;
  materializedDirectory: string;
};

type Catalog = Pick<Workspace, "collectionsDirectory" | "areasDirectory">;

export function requireWorkspace(start = process.cwd()): Workspace {
  const root = findWorkspaceRoot(start);
  if (!root) {
    throw new Error(`No Filoscope workspace found from ${start}: expected a collections/ directory`);
  }
  return workspace(root);
}

export function resolveCatalog(start = process.cwd()): Catalog {
  const root = findWorkspaceRoot(start) ?? bundledDefinitionsRoot;
  return {
    collectionsDirectory: path.join(root, "collections"),
    areasDirectory: path.join(root, "areas"),
  };
}

function findWorkspaceRoot(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    try {
      if (statSync(path.join(current, "collections")).isDirectory()) return current;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function workspace(root: string): Workspace {
  return {
    root,
    collectionsDirectory: path.join(root, "collections"),
    areasDirectory: path.join(root, "areas"),
    materializedDirectory: path.join(root, ".filoscope", "collections"),
  };
}
