import { github } from "../src/connectors/github.ts";

export default github({
  name: "filecoin-services",
  context: "Smart contracts, specifications, ABI artifacts, deployment addresses, tests, and runbooks for Filecoin Warm Storage Service, covering PDP proof validation, FilecoinPay rails, USDFC pricing, CDN and FilBeam settlement, provider registry, StateView extsload access, UUPS upgrades, and releases.",
  repository: "FilOzone/filecoin-services",
  include: "**/*.{md,sol,ts,js,json,toml,yml,yaml}",
});
