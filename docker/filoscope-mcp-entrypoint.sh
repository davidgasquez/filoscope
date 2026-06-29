#!/bin/sh
set -eu

QMD_INDEX_NAME="${QMD_INDEX_NAME:-filoscope}"
QMD_HOST="${QMD_HOST:-0.0.0.0}"
QMD_PORT="${QMD_PORT:-8181}"
FILOSCOPE_INDEX_URL="${FILOSCOPE_INDEX_URL:-https://github.com/davidgasquez/filoscope/releases/latest/download/filoscope.sqlite.gz}"

CACHE_DIR="${XDG_CACHE_HOME:-/data/cache}/qmd"
DB_PATH="${CACHE_DIR}/${QMD_INDEX_NAME}.sqlite"

mkdir -p "${CACHE_DIR}" "${XDG_CONFIG_HOME:-/data/config}/qmd"

if [ ! -s "${DB_PATH}" ]; then
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  echo "Downloading ${FILOSCOPE_INDEX_URL}" >&2
  curl -fL "${FILOSCOPE_INDEX_URL}" -o "${tmp_dir}/filoscope.sqlite.gz"
  gzip -dc "${tmp_dir}/filoscope.sqlite.gz" > "${tmp_dir}/filoscope.sqlite"

  integrity="$(sqlite3 "${tmp_dir}/filoscope.sqlite" 'PRAGMA integrity_check;')"
  if [ "${integrity}" != "ok" ]; then
    echo "SQLite integrity_check failed: ${integrity}" >&2
    exit 1
  fi

  mv "${tmp_dir}/filoscope.sqlite" "${DB_PATH}"
fi

exec node /opt/qmd/dist/cli/qmd.js --index "${QMD_INDEX_NAME}" mcp --http --host "${QMD_HOST}" --port "${QMD_PORT}" "$@"
