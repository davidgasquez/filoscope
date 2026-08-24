import { github } from "../src/connectors/github.ts";

export default github({
  name: "lily",
  context: "Instrumented Lotus-based Filecoin indexer source covering chain walking, tipset watching, actor state extraction, messages, receipts, gas economics, FEVM transactions, traces, contracts, TimescaleDB schemas and migrations, CSV storage, network surveys, and deployment operations tooling.",
  repository: "filecoin-project/lily",
  include: "**/*.{md,go,sql,sh,toml,json,yml,yaml}",
});
