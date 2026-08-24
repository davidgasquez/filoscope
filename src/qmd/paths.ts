import os from "node:os";
import path from "node:path";

export const QMD_INDEX_NAME = "filoscope";
export const QMD_INDEX_ASSET = "filoscope.sqlite.gz";
export const QMD_RELEASE_PREFIX = "filoscope-index-";

export function qmdConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configDirectory = process.env.QMD_CONFIG_DIR || path.join(configHome, "qmd");
  return path.join(configDirectory, `${QMD_INDEX_NAME}.yml`);
}

export function qmdIndexPath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "qmd", `${QMD_INDEX_NAME}.sqlite`);
}

export function qmdReleaseTagPath(): string {
  return path.join(path.dirname(qmdIndexPath()), `${QMD_INDEX_NAME}.release-tag.txt`);
}
