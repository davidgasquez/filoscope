import { github } from "../src/connectors/github.ts";

export default github({
  name: "synapse-sdk",
  context: "TypeScript and JavaScript monorepo and docs for Synapse SDK, Core, and React packages integrating Filecoin Onchain Cloud storage, Filecoin Pay, Warm Storage, PDP verification, provider discovery, PieceCID handling, session keys, examples, and playground apps.",
  repository: "FilOzone/synapse-sdk",
  include: "**/*.{md,mdx,ts,tsx,js,json,yml,yaml}",
});
