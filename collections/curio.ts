import { github } from "../src/connectors/github.ts";

export default github({
  name: "curio",
  context: "Go implementation of Filecoin Curio storage-provider software, covering sector sealing and proving, task scheduling, storage orchestration, deal and market workflows, APIs, CLI operations, configuration, deployment, monitoring, and integration tests.",
  repository: "filecoin-project/curio",
  include: "**/*.{md,go,sh,sql,toml,json,yml,yaml}",
});
