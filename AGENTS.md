# Rules

Minimal and local-friendly Filecoin knowledge base.

## Principles

- Minimal, opinionated, declarative, and UNIXy
- The repository is the platform
- Filesystem first; useful local files are the primary output
- Declarative TypeScript collection and area definitions are the source of truth
- One collection = one logical entity = one folder
- Sources stay canonical
  - Repository connectors preserve selected files and paths
  - Document connectors emit Markdown with minimal OKF frontmatter and canonical resource links
- Idempotent and deterministic full refreshes should converge to the same folder state
- As stateless as practical; no checkpoints, watermarks, or sync metadata
- Persist files and derive views such as QMD indexes and embeddings
- Good UX
  - Compose directly with [`tobi/qmd`](https://github.com/tobi/qmd) instead of wrapping retrieval
  - Filoscope owns QMD config, build, pull, and publish as a deployment target
  - Useful errors and good docs for humans and agents

## Code

- Keep the kernel small and explicit
- Use small typed connector functions with connector-owned validation
- Use Node.js 22.21.1+, TypeScript, and npm
- Compile npm artifacts to JavaScript
- Generated state must always be reconstructable
- Do not preserve backward compatibility unless asked

## Collections

- `collections/*.ts` and `areas/*.ts` are the control plane
- Connector factories return collections with closed-over materialization functions
- Collection names are explicit and globally unique
- Each collection file exports exactly one collection
- Connectors materialize into `.filoscope/collections/<name>/`
- Areas are overlapping views and never duplicate collection files
- QMD config and the publishable SQLite index are generated deployment artifacts
- Prefer full refreshes over hidden mutable state
