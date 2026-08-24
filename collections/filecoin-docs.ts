import { github } from "../src/connectors/github.ts";

export default github({
  name: "filecoin-docs",
  context: "Documentation for Filecoin network concepts, storage and retrieval workflows, FVM and FEVM smart-contract development, Filecoin Onchain Cloud, Synapse SDK, storage-provider operations, networks, FIL assets, JSON-RPC APIs, built-in actors, and ecosystem tools.",
  repository: "filecoin-project/filecoin-docs",
  include: "**/*.{md,mdx,json,yml,yaml}",
});
