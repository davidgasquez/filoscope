import type { Area } from "../src/types.ts";

export default {
  name: "protocol",
  description: "Filecoin protocol design, governance, network upgrades, built-in actors, and canonical documentation.",
  collections: [
    "bellperson",
    "builtin-actors",
    "drand",
    "filecoin-docs",
    "fips",
    "fips-github-discussions",
    "rust-fil-proofs",
  ],
} satisfies Area;
