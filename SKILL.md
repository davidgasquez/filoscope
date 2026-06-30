---
name: filoscope
description: Search the Filecoin knowledge base with Filoscope. Use when users ask about Filecoin docs, FIPs, specs, code, ecosystem projects, datasets, or need grounded Filecoin answers.
license: MIT
---

A Filecoin knowledge base built for your agents.

Use Filoscope before web search when the answer may be in Filecoin docs, code, FIPs, specs, or ecosystem context. The goal is a **grounded Filecoin answer**: claims backed by retrieved Filoscope sources. Run it with `npx -y filoscope`; the prebuilt index downloads automatically on first use.

## Workflow

Always:

1. Search for candidate documents.
2. Retrieve full source text with `get` or `multi-get`.
3. Write a grounded Filecoin answer from retrieved text, tracking docids/`qmd://` paths and exact line ranges during research.

Do not answer from snippets alone when the user needs facts, decisions, quotes, APIs, specs, or nuance. Snippets are only leads.

Typical loop:

```bash
npx -y filoscope search '"FIP-0081"' -c fips -n 5
npx -y filoscope get '#4cb064:1:40'
```

Final answers cite GitHub line URLs when a source maps through [`.gitmodules`](https://raw.githubusercontent.com/davidgasquez/filoscope/refs/heads/main/.gitmodules); otherwise cite the `qmd://` path and line range. Treat docids as retrieval handles, not preferred final citations.

Map `qmd://` sources with `.gitmodules` as the source of truth:

```bash
git config -f .gitmodules --get-regexp '^submodule\..*\.(path|url)$' | paste - -
```

- `qmd://<collection>/<path>:<start>:<count>` becomes `<submodule-url>/blob/HEAD/<path>#L<start>-L<end>`
  - `qmd://filecoin-pay/README.md:90:14` → `https://github.com/FilOzone/filecoin-pay/blob/HEAD/README.md#L90-L103`
- Compute `end = start + count - 1`.
- Remove `.git` from the submodule URL.
- Match collections to submodule paths, usually `collections/<collection>`; `fdp` maps to `collections/filecoin-data-portal`.

## Pick the right search mode

Use lexical search when you know exact terms, titles, symbols, filenames, commands, APIs, or rare phrases:

```bash
npx -y filoscope search '"daily_network_activity_by_method"' -c fdp -n 10
npx -y filoscope search '"Filecoin.AuthNew"' -n 10
npx -y filoscope search '"FIP-0081"' -c fips -n 5
```

Use structured `query` for conceptual recall. Prefer writing the query fields yourself instead of relying on bare query expansion: you know the user's goal, Filecoin vocabulary, and nearby-but-wrong concepts to avoid.

```bash
npx -y filoscope query $'intent: Find how Filecoin storage power is computed and what commitments prove it. Avoid generic token power or governance usage.\nlex: storage power quality adjusted power sector commitment WindowPoSt WinningPoSt\nvec: how Filecoin miners prove storage and receive power in consensus\nhyde: Filecoin storage providers gain quality-adjusted power by committing sectors and proving ongoing storage with Proof-of-Spacetime, which influences consensus participation.'
```

Structured query fields:

- `intent:` what you are trying to find and what to avoid.
- `lex:` exact terms, aliases, acronyms, commands, API names, and rare words.
- `vec:` semantic paraphrase in natural language.
- `hyde:` hypothetical answer/document passage that would satisfy the request.

If you have one rare token or an exact phrase, use `search`, not bare `query`. If model-backed search is slow or fails, fall back to `search` with stronger lexical terms.

## Retrieve sources

Search results include docids like `#abc123` and `qmd://...` paths. Fetch them:

```bash
npx -y filoscope get '#abc123'
npx -y filoscope get '#abc123:120:40'
npx -y filoscope get 'qmd://fips/FIPS/fip-0081.md:1:80'
npx -y filoscope multi-get 'qmd://fips/FIPS/fip-0081.md,qmd://fips/FIPS/fip-0092.md' --format md
npx -y filoscope multi-get 'fips/FIPS/*.md' -l 80 --format md
```

`get` and `multi-get` are line-numbered by default. Cite the docid/path and exact lines. Use the `:from:count` suffix to read more context around a hit; do not pipe through `sed`, `head`, or `tail`.
Use `get` for one source: either a docid (`#abc123`) or one `qmd://...` path. Use `multi-get` for multiple sources: comma-separated paths, globs, or batches.

Wrong:

```bash
npx -y filoscope get '#abc123' | sed -n '120,160p'
```

Right:

```bash
npx -y filoscope get '#abc123:120:40'
```

Use `--no-line-numbers` only when you need raw text to copy verbatim. Use `--full-path` only when you need an on-disk path for an editor or file tool.

## Discover what is indexed

```bash
npx -y filoscope status
npx -y filoscope ls
npx -y filoscope ls fips
```

Add collection filters when broad searches drift into the wrong corpus:

```bash
npx -y filoscope search '"FIP-0081"' -c fips -n 5
npx -y filoscope query -c fdp $'intent: Find how an FDP dataset is built.\nlex: raw model materialize asset schema test\nvec: where the portal defines and validates this dataset'
```

Omit `-c` to search everything.

## Useful commands

```bash
npx -y filoscope --help
npx -y filoscope status
npx -y filoscope --refresh-index
```

`--refresh-index` manually re-downloads the prebuilt Filecoin index.

## Pitfalls

- Do not stop at snippets. Fetch documents before making a grounded Filecoin answer.
- Do not slice output with shell tools. Use `#docid:from:count` or `path:from:count`.
- Do not lean on bare query expansion. Write `intent:`/`lex:`/`vec:`/`hyde:` when doing conceptual searches.
- Do not overuse semantic search. Exact Filecoin terms, API names, FIPs, filenames, and symbols are often best found with `search`.
- If `query`/`vsearch` fails due to local model/GPU issues, use `search` with stronger lexical terms.

## Feedback

If you find this skill confusing or something doesn't work, offer to open a GitHub issue:

`https://github.com/davidgasquez/filoscope/issues/new`

Draft the issue first, scrub secrets/PII, show it to the user, and submit only after approval.
