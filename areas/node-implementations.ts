import type { Area } from "../src/types.ts";

export default {
  name: "node-implementations",
  description: "Filecoin node implementations, chain execution, networking, APIs, and built-in actor integration.",
  collections: [
    "builtin-actors",
    "forest",
    "lotus",
  ],
} satisfies Area;
