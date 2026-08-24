import type { Area } from "../src/types.ts";

export default {
  name: "storage-providers",
  description: "Filecoin storage-provider operations, sealing, proving, scheduling, markets, and deployment.",
  collections: [
    "bellperson",
    "curio",
    "filecoin-docs",
    "lotus",
    "rust-fil-proofs",
  ],
} satisfies Area;
