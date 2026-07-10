import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const QMD_INDEX_NAME = "filoscope";

export function qmdConfigPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "qmd", `${QMD_INDEX_NAME}.yml`);
}

export function qmdIndexPath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "qmd", `${QMD_INDEX_NAME}.sqlite`);
}

export function qmdReleaseTagPath() {
  return path.join(path.dirname(qmdIndexPath()), `${QMD_INDEX_NAME}.release-tag.txt`);
}

export function projectRoot(start = process.cwd()) {
  let current = path.resolve(start);

  while (true) {
    try {
      if (
        statSync(path.join(current, "collections")).isDirectory()
        && statSync(path.join(current, "connectors")).isDirectory()
      ) {
        return current;
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `No Filoscope workspace found from ${start}: expected collections/ and connectors/ directories`,
  );
}

export function collectionsRoot() {
  return path.join(projectRoot(), "collections");
}

export function connectorsRoot() {
  return path.join(projectRoot(), "connectors");
}

export function materializedRoot() {
  return path.join(projectRoot(), ".filoscope", "collections");
}
