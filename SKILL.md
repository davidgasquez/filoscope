---
name: filoscope
description: Search and retrieve grounded Filecoin ecosystem context from the prebuilt filoscope QMD index. Use when users ask about Filecoin docs, FIPs/FRCs, Lotus, Forest, Lily, built-in actors, Filecoin Data Portal, Filecoin Pay, PDP, Synapse SDK, Filecoin services, PoRep Market, or other indexed Filecoin ecosystem code/docs and need source-backed answers.
---

# Filoscope

Use `filoscope` before web search when the answer may be in Filecoin ecosystem docs or code. The workflow is:

1. Search for candidate documents.
2. Retrieve source text with `get` or `multi-get`.
3. Answer from retrieved text, citing paths, docids, and line numbers when available.

Do not answer from search snippets alone when the user needs facts, quotes, decisions, protocol behavior, or implementation details. Snippets are leads.

## Commands

Run through `npx -y filoscope@latest` unless a local binary is available. The `-y` is required so agents do not hang on npm's install prompt, and `@latest` makes npm resolve the current published package:

```bash
npx -y filoscope@latest status
npx -y filoscope@latest search '"FIP-0081"' -c fips -n 10
npx -y filoscope@latest query "how does Filecoin storage power work"
npx -y filoscope@latest get '#4cb064:1:40'
npx -y filoscope@latest multi-get 'fips/FIPS/*.md' -l 80 --format md
```

The first command that needs the index downloads it automatically. Use `npx -y filoscope@latest pull --force` only when the user asks to refresh the cached index or the cache appears stale.

## Pick The Search Mode

Use lexical search when you know exact terms, titles, identifiers, code symbols, error strings, FIP numbers, contract names, or rare phrases:

```bash
npx -y filoscope@latest search '"daily_network_activity_by_method"' -c fdp -n 10
npx -y filoscope@latest search '"SubmitWindowedPoSt"' -c lotus -n 10
```

Use structured `query` when the user describes an idea indirectly or the source may use different wording. Write the fields yourself:

```bash
npx -y filoscope@latest query -c fdp $'intent: Find how a Filecoin Data Portal dataset is built, not user-facing docs.\nlex: raw model main materialize asset schema test\nvec: where the portal defines validates and publishes this dataset'
```

Field guidance:

- `intent:` states what to find and what to avoid.
- `lex:` lists exact terms, aliases, titles, code symbols, and rare words.
- `vec:` paraphrases the desired source in natural language.
- `hyde:` describes the document or answer that would satisfy the request.

Prefer `intent:` plus `lex:` or `vec:`. If you only have one rare token or exact phrase, use `search`, not bare `query`.

Use `vsearch` only when semantic recall is needed and lexical terms are weak:

```bash
npx -y filoscope@latest vsearch "how retrieval and payment settlement interact" -n 10
```

If model-backed commands fail or are slow, fall back to `search` with stronger lexical terms.

## Retrieve Sources

Search results include docids like `#abc123` and display paths. Fetch the source before relying on it:

```bash
npx -y filoscope@latest get '#abc123'
npx -y filoscope@latest get '#abc123:120:40'
npx -y filoscope@latest get 'qmd://lotus/chain/types/blockheader.go:1:80'
npx -y filoscope@latest multi-get '#abc123,#def456' --format md
npx -y filoscope@latest multi-get 'filecoin-docs/**/*.md' -l 80 --format md
```

Use the `:from:count` suffix to read around a hit. Prefer another `get` range over shell slicing, because `filoscope get` preserves docid lookup, paths, and line numbers.

Use `multi-get` when comparing several hits or gathering adjacent context. Keep retrieval bounded with `-l` or `--max-bytes` when matching broad globs.

## Output Formats

Use `--format json` for machine parsing and `--format md` when you want compact markdown suitable for quoting or comparing multiple docs:

```bash
npx -y filoscope@latest search '"PieceCID"' -c synapse-sdk --format json
npx -y filoscope@latest get '#abc123:40:80' --format md
```

## Pitfalls

- Do not stop at snippets; fetch documents before making claims.
- Do not mutate or refresh the cache unless needed for the task.
- Do not overuse semantic search when exact anchors exist.
- Do not paste the user's sentence into bare `query` when you can write better `intent:`, `lex:`, and `vec:` fields.
- Check `npx -y filoscope@latest status` when cache state, collection names, or index freshness matters.
