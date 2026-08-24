import { github } from "../src/connectors/github.ts";

export default github({
  name: "filecoin-pay",
  context: "Solidity and Foundry implementation and documentation for FilecoinPayV1 payment rails on Filecoin, covering ERC20 and FIL account funding, operator approvals, lockup accounting, rate changes, one-time payments, validator arbitration, settlement, termination, fees, deployments, audits, and tests.",
  repository: "FilOzone/filecoin-pay",
  include: "**/*.{md,sol,sh,json,toml,yml,yaml}",
});
