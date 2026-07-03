# Rules

Minimal and local-friendly Filecoin knowledge base.

## Principles

- Minimal, opinionated, and UNIXy
- The repository is the platform
- Configuration first
  - Derive collections and indexes idempotently from YAML files
- One collection = one logical entity = one folder
- Sync commands are plain scripts
- Declarative
- Idempotent and deterministic syncs rerunning should converge to the same folder state
- As stateless as practical
  - No metadata, checkpoints, watermark, ...
- Good UX
  - Hides QMD internals behind simple commands
  - Useful errors
  - Good docs for humans and agents

## Code

- Keep the kernel (filoscope) small and explicit.
- Rely on JS packages and tooling so we can bundle everything.
- Use Node.js 22+ and npm for this package
- Generated state should always be reconstructable
- Do not preserve backward compatibility unless asked

## Collections

A collection definition should be a small YAML file describing it.

```yaml
name: lotus
context: Go implementation of Filecoin Lotus node, miner, worker, gateway, APIs, sealing, proving, FVM execution, and operations.
include:
  - "**/*.{md,go,sh,yml,yaml,json}"
sync: |
  git https://github.com/filecoin-project/lotus.git "$COLLECTION_PATH"
```

### Conventions

- `collections/*.yml` are the source of truth
- `.qmd/index.yml` is generated from collection YAML files
- `.qmd/index.sqlite` is generated and publishable as an artifact
- Prefer full refresh/idempotent syncs over hidden mutable state
