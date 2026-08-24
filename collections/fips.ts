import { github } from "../src/connectors/github.ts";

export default github({
  name: "fips",
  context: "Filecoin Improvement Proposal records covering FIPs and FRCs for protocol changes, governance process, standards, network upgrades, storage-market economics, FVM and FEVM behavior, consensus, proofs, node APIs, and proposal lifecycle metadata from draft through final.",
  repository: "filecoin-project/FIPs",
  include: "**/*.{md,txt,json,yml,yaml}",
});
