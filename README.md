# Filoscope 🔭

A Filecoin knowledge base built for your agents.

Filoscope syncs Filecoin sources into local filesystem collections, builds a QMD index, and exposes a simple search CLI. Published releases also include a prebuilt index, so agents can use it with zero setup.

## 🚀 Quick Start

Ask your agent:

```text
Read https://raw.githubusercontent.com/davidgasquez/filoscope/refs/heads/main/SKILL.md and tell me how Filecoin Pay rails work
```

Or use the published index directly:

```bash
npx -y filoscope query "how does Filecoin storage power work"
npx -y filoscope search '"FIP-0081"' -c fips -n 5
npx -y filoscope get '#4cb064:1:40'
```

The first search downloads the prebuilt Filecoin index automatically.

## 🧱 Local index

Each `collections/*.yml` file defines one QMD collection and the command that materializes it. The output folder is derived from `name`: `.filoscope/collections/<name>`.

```bash
npm ci
npm run sync                        # sync sources, update QMD, embed
node src/cli.js query "..."          # query the local index
```

Useful shortcuts:

```bash
npm run sync
npm run index
npm run status
```

## 🧰 Commands

```bash
filoscope sync [collection...]      # run collection sync commands
filoscope qmd-config                # generate QMD config from collections/*.yml
filoscope index [collection...]     # sync, generate config, update, embed
filoscope collections               # list collection definitions
filoscope status
filoscope --refresh-index
filoscope --help
```

## 📜 License

MIT
