# Rules

Minimal and local-friendly Filecoin knowledge base.

## Principles

- Minimal, opinionated, and UNIXy
- The repository is the platform
- Configuration first
  - Derive collections and indexes idempotently from YAML files
- One collection = one logical entity = one folder
- Connectors are bundled Node.js scripts selected by source scheme
- Declarative
- Idempotent and deterministic syncs rerunning should converge to the same folder state
- As stateless as practical
  - No metadata, checkpoints, watermark, ...
- Good UX
  - Composes directly with [`tobi/qmd`](https://github.com/tobi/qmd) instead of wrapping it
  - Useful errors
  - Good docs for humans and agents

## Code

- Keep the kernel (filoscope) small and explicit
- Rely on JS packages and tooling so we can bundle everything
- Use Node.js 22+ and npm for this package
- Generated state should always be reconstructable
- Do not preserve backward compatibility unless asked

## Collections

A collection definition is a small YAML file.
Connectors materialize sources and QMD indexes files matching `pattern`.

`collections/lotus.yml`:

```yaml
source: github:filecoin-project/lotus
context: Go implementation of Filecoin Lotus node, miner, worker, and gateway, ...
pattern: "**/*.{md,go,sh,toml,json,yml,yaml}"
```

### Conventions

- Collection names are derived from filenames
- `collections/*.yml` are the source of truth
- `source`, `context`, and scalar `pattern` are required
- Everything targets the `filoscope` named QMD index (`qmd --index filoscope`)
- The QMD config (`$XDG_CONFIG_HOME/qmd/filoscope.yml`) is generated from collection YAML files
- The index (`$XDG_CACHE_HOME/qmd/filoscope.sqlite`) is generated and publishable as an artifact
- Prefer full refresh/idempotent syncs over hidden mutable state
