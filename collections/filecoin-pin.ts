import { github } from "../src/connectors/github.ts";

export default github({
  name: "filecoin-pin",
  context: "TypeScript implementation of Filecoin Pin for persistent, verifiable IPFS content storage on Filecoin PDP, covering CLI commands, JavaScript library APIs, GitHub upload action, beta IPFS Pinning Service API server, Synapse SDK integration, CAR/UnixFS uploads, payment and session-key flows, provider selection, telemetry, docs, examples, and tests.",
  repository: "filecoin-project/filecoin-pin",
  include: "**/*.{md,ts,js,json,yml,yaml}",
});
