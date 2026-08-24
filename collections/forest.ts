import { github } from "../src/connectors/github.ts";

export default github({
  name: "forest",
  context: "Rust Filecoin node collection covering Forest daemon, CLI, wallet, tool binaries, JSON-RPC, OpenRPC APIs, chain sync and validation, FVM state execution and migrations, libp2p networking, snapshots, CAR storage, Ethereum compatibility, F3 sidecar, monitoring, tests, CI, and docs.",
  repository: "ChainSafe/forest",
  include: "**/*.{md,rs,sh,toml,json,yml,yaml}",
});
