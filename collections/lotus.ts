import { github } from "../src/connectors/github.ts";

export default github({
  name: "lotus",
  context: "Go implementation of Filecoin Lotus node, miner, worker, and gateway, including chain sync and validation, FVM state execution, message pool, storage sealing and proving, APIs, CLI, Ethereum compatibility, F3 finality, indexing, monitoring, releases, and integration tests.",
  repository: "filecoin-project/lotus",
  include: "**/*.{md,go,sh,toml,json,yml,yaml}",
});
