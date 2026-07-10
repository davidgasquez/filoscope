---
name: filoscope
description: Use and search Filecoin knowledge base with `qmd`. Use when answering questions about Filecoin docs, FIPs, specs, code, ecosystem projects, or datasets.
license: MIT
---

Pull the current prebuilt index.

```bash
npx filoscope pull
```

Run `npx qmd skill show` and follow its search and retrieval workflow.
Use `qmd` directly, adding `--index filoscope` to its search, query, and retrieval commands.

For example:

```bash
npx qmd --index filoscope search 'FIP-0081' -c fips -n 5
npx qmd --index filoscope get 'qmd://fips/FIPS/fip-0081.md'
```

## Rules

- Give grounded answers. Back claims by retrieved Filoscope sources.
- Do not answer from snippets alone when the user needs facts, decisions, quotes, APIs, specs, or nuance. Snippets are only leads.
- Final answers cite GitHub line URLs. Never cite in `qmd://` style. Treat docids as retrieval handles, not final citations. Explore the relevant [collection](./collections) - [connector](./connector) pair and produce real URLs.
  - `qmd://filecoin-pay/README.md:90:14` → `https://github.com/FilOzone/filecoin-pay/blob/HEAD/README.md#L90-L103`

## Feedback

If you hit any issue, find parts of this skill confusing for what the user has asked, or something else doesn't work, offer to [open a GitHub issue](https://github.com/davidgasquez/filoscope/issues/new).

Draft the issue first (include goal, context, anything else useful in a concise and reproducible way), scrub secrets/PII, show it to the user, and submit only after approval.
