import { github } from "../src/connectors/github.ts";

export default github({
  name: "bellperson",
  context: "Rust zk-SNARK library underpinning Filecoin sealing and proof generation, covering Groth16 proving and verification, GPU acceleration for multiexponentiation and FFT, circuit synthesis primitives and gadgets, and verifier benchmarks.",
  repository: "filecoin-project/bellperson",
  include: "**/*.{md,rs,toml,json,yml,yaml,sh}",
});
