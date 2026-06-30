# Filoscope 🔭

A Filecoin knowledge base built for your agents.

Filoscope gives agents and humans zero-setup search over current Filecoin docs, code, FIPs, specs, and ecosystem context.

## 🚀 Quick Start

Ask your agent:

```text
Read https://raw.githubusercontent.com/davidgasquez/filoscope/refs/heads/main/SKILL.md and tell me how Filecoin Pay rails work
```

Or use it directly:

```bash
npx filoscope query "how does Filecoin storage power work"
npx filoscope search '"FIP-0081"' -c fips -n 5
npx filoscope get '#4cb064:1:40'
```

The first command downloads the prebuilt Filecoin index automatically.

## 🧰 Useful Commands

```bash
npx filoscope status
npx filoscope --refresh-index
npx filoscope --help
```

## 📜 License

MIT
