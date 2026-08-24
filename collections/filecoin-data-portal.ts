import { github } from "../src/connectors/github.ts";

export default github({
  name: "filecoin-data-portal",
  context: "Filecoin Data Portal codebase for a local-first DuckDB and Python pipeline indexing Filecoin datasets, asset metadata, tests, docs, and web publishing for network metrics, providers, clients, verified claims, DataCap, FEVM logs, Filecoin Pay, PDP, and warm storage.",
  repository: "davidgasquez/filecoin-data-portal",
  include: "**/*.{md,py,sql,ts,json,toml,yml,yaml}",
});
