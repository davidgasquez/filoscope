import type { Area } from "../src/types.ts";

export default {
  name: "data",
  description: "Filecoin chain indexing, datasets, analytics, schemas, and network metrics.",
  collections: [
    "filecoin-data-portal",
    "lily",
  ],
} satisfies Area;
