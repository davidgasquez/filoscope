import { github } from "../src/connectors/github.ts";

export default github({
  name: "drand",
  context: "Go implementation of the drand distributed randomness beacon that powers the League of Entropy, covering threshold-BLS distributed key generation and resharing, beacon chain rounds and catchup, gRPC and HTTP public APIs with their protobuf definitions, node and client CLIs, pluggable crypto schemes, and multi-node demo and test harnesses.",
  repository: "drand/drand",
  include: "**/*.{md,go,sh,toml,json,yml,yaml}",
});
