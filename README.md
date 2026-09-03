# Filoscope

Filoscope materializes Filecoin knowledge as a local tree of useful files.
It can also build and publish a named [QMD](https://github.com/tobi/qmd) index from those files.

Collections and areas are TypeScript values. Each connector validates its own options and writes one collection to `.filoscope/collections/<name>/`. Repository connectors preserve selected source files. Document connectors write Markdown with minimal OKF frontmatter and links to the canonical source.

## Use the published index

Install the latest published index and its QMD configuration:

```bash
npx -y --allow-remote=all filoscope pull
```

The index is named `filoscope`, so you can search it from any directory:

```bash
npx -y --allow-remote=all -p filoscope qmd --index filoscope search 'FIP-0081' -c fips -n 5
npx -y --allow-remote=all -p filoscope qmd --index filoscope query 'how do storage providers prove storage over time'
npx -y --allow-remote=all -p filoscope qmd --index filoscope get 'qmd://fips/FIPS/fip-0081.md'
```

Areas provide reusable collection filters for broad subjects:

```bash
npx -y --allow-remote=all filoscope areas
npx -y --allow-remote=all filoscope area onchain-cloud
```

You can pass the result directly to QMD:

```bash
npx -y --allow-remote=all -p filoscope qmd --index filoscope query \
  'how are PDP storage payments settled?' \
  $(npx -y --allow-remote=all filoscope area onchain-cloud)
```

## Materialize local files

Use Node.js 22.21.1 or later. Clone the repository and install its dependencies:

```bash
npm ci --allow-remote=all
```

Materialize every collection, or name the collections you need:

```bash
npm run filoscope -- sync
npm run filoscope -- sync fips lotus
```

`sync` only writes local collection files. It does not require QMD and does not generate QMD configuration. A full sync removes undeclared collection directories. A named sync leaves other directories unchanged.

Generate the named QMD configuration when you want to build an index:

```bash
npm run filoscope -- config
npm exec -- qmd --index filoscope update
npm exec -- qmd --index filoscope embed
```

## Define a collection

Each file in `collections/` exports exactly one collection. Collection names are explicit and must be unique across the workspace.

```ts
import { github } from "../src/connectors/github.ts";

export default github({
  name: "lotus",
  context: "Go implementation of the Filecoin Lotus node, miner, worker, and gateway.",
  repository: "filecoin-project/lotus",
  include: "**/*.{md,go,sh,toml,json,yml,yaml}",
});
```

The `include` option controls which repository files are materialized. QMD uses `**/*` for every collection because connectors only write useful files.

Filoscope also includes connectors for GitHub Discussions, Google Drive, and Slack. Document connectors emit one Markdown file for each source unit and use this frontmatter:

```yaml
type: Reference
title: Document title
context: Why this collection exists
resource: https://canonical.example/document
updated_at: 2026-08-20T10:00:00Z
```

## Define an area

Each file in `areas/` exports one area containing collection names:

```ts
import type { Area } from "../src/types.ts";

export default {
  name: "protocol",
  description: "Filecoin protocol design, governance, network upgrades, and built-in actors.",
  collections: ["builtin-actors", "fips", "fips-github-discussions"],
} satisfies Area;
```

Areas only select QMD collections. They do not copy or materialize files.

## Publish the index

`publish` checks for a GitHub token and a clean commit that exists on GitHub. It then syncs every collection, generates the QMD configuration, updates and embeds the index, validates SQLite, compresses the database, and creates a GitHub release.

```bash
GH_TOKEN="$(gh auth token)" npm run filoscope -- publish
```

The scheduled GitHub workflow uses the same command. A separate workflow keeps the seven newest index releases.

## Develop

Run all static checks and fixture tests before packing the package:

```bash
npm run check
npm test
npm pack
```

`npm test` includes a packed package test. It installs the tarball in a temporary project and runs the compiled `filoscope` bin without a TypeScript loader.

## License

MIT
