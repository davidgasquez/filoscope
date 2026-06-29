# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim
ARG QMD_REF=e428df76bc0274d9e93eb7ca3e95673315c42e90

FROM ${NODE_IMAGE} AS qmd-builder
ARG QMD_REF

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/qmd
RUN git clone https://github.com/tobi/qmd.git . \
  && git checkout "${QMD_REF}" \
  && printf '%s\n' \
    'allowBuilds:' \
    '  better-sqlite3: true' \
    '  esbuild: true' \
    '  node-llama-cpp: true' \
    '  tree-sitter-go: true' \
    '  tree-sitter-javascript: true' \
    '  tree-sitter-python: true' \
    '  tree-sitter-rust: true' \
    '  tree-sitter-typescript: true' \
    > pnpm-workspace.yaml \
  && corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm build \
  && pnpm prune --prod

FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gzip sqlite3 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  XDG_CACHE_HOME=/data/cache \
  XDG_CONFIG_HOME=/data/config \
  QMD_FORCE_CPU=1 \
  QMD_SOURCE_MODE=0 \
  QMD_HOST=0.0.0.0 \
  QMD_PORT=8181

COPY --from=qmd-builder /opt/qmd /opt/qmd
COPY docker/filoscope-mcp-entrypoint.sh /usr/local/bin/filoscope-mcp-entrypoint

RUN chmod +x /usr/local/bin/filoscope-mcp-entrypoint

EXPOSE 8181
ENTRYPOINT ["filoscope-mcp-entrypoint"]
