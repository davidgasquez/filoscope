# Filoscope 🔭

A Filecoin knowledge base built for your agents.

Filoscope bundles Filecoin docs, FIPs, specs, code, and ecosystem projects into a single searchable index. No setup needed!

## 🚀 Quick Start

Point your agent at the [Filoscope SKILL](https://raw.githubusercontent.com/davidgasquez/filoscope/refs/heads/main/SKILL.md) and ask away.

```
Read https://raw.githubusercontent.com/davidgasquez/filoscope/refs/heads/main/SKILL.md and tell me how Filecoin Pay Rails work
```

### 🔎 CLI

You can manually update the index. Filoscope checks the latest release tag and downloads the database only when it has changed.

```bash
npx filoscope pull
```

The downloaded database lives in a named `filoscope` index for [`qmd`](https://github.com/tobi/qmd). Search it from anywhere with `--index filoscope`.

```bash
npx qmd --index filoscope search 'FIP-0081' -c fips -n 5
npx qmd --index filoscope query 'how do storage providers prove storage over time'
npx qmd --index filoscope get 'qmd://fips/FIPS/fip-0081.md'
```

To build an index from the sources, run these commands from the repository. The `sync` command materializes the collections and generates the named `filoscope` QMD config. A GitHub token is required to export FIP discussions.

```bash
GH_TOKEN="$(gh auth token)" npx filoscope sync
npx qmd --index filoscope update && npx qmd --index filoscope embed
```

## 📦 Developing

Each collection is a YAML file in [`collections/`](collections/) pointing to a source repository. A [GitHub Action](.github/workflows/build-index.yml) syncs all collections daily, builds the [`qmd`](https://github.com/tobi/qmd) index, and publishes it as a release artifact.

From a clean worktree with `HEAD` pushed to GitHub, run the same publish path locally:

```bash
GH_TOKEN="$(gh auth token)" npm run filoscope -- publish
```

### 🛠️ Adding a collection

Drop a YAML file in `collections/` with `source`, `context`, and `pattern`:

```yaml
source: github:filecoin-project/lotus
context: Go implementation of Filecoin Lotus node, miner, worker, and gateway.
pattern: "**/*.{md,go,sh,toml,json,yml,yaml}"
```

Connectors are picked by the source scheme (`github:`, `github-discussion:`).

## 📜 License

MIT
