import { github } from "../src/connectors/github.ts";

export default github({
  name: "rust-fil-proofs",
  context: "Rust implementation of Filecoin's proving subsystem, covering PoRep StackedDRG sealing, WindowPoSt and WinningPoSt, the storage-proofs core, porep and post crates, the filecoin-proofs public API, Poseidon and SHA-256 hashers, fr32 field encoding, Groth16 parameter generation and fetching, benchmarking tooling, and security audits.",
  repository: "filecoin-project/rust-fil-proofs",
  include: "**/*.{md,rs,toml,json,yml,yaml,sh}",
});
