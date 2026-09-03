---
name: filoscope
description: Search the Filecoin knowledge base with QMD. Use for Filecoin documentation, FIPs, specifications, code, ecosystem projects, and datasets.
license: MIT
---

Install or update the current published index:

```bash
npx -y --allow-remote=all filoscope pull
```

Run `npx -y --allow-remote=all -p filoscope qmd skill show` and follow its search and retrieval process. Invoke the bundled QMD CLI with `npx -y --allow-remote=all -p filoscope qmd`.

For example:

```bash
npx -y --allow-remote=all -p filoscope qmd --index filoscope search 'FIP-0081' -c fips -n 5
npx -y --allow-remote=all -p filoscope qmd --index filoscope get 'qmd://fips/FIPS/fip-0081.md'
```

List the available areas when an unscoped search is too broad. Resolve an area to QMD collection filters:

```bash
npx -y --allow-remote=all filoscope areas
npx -y --allow-remote=all filoscope area onchain-cloud
```

Pass the emitted `-c <collection>` arguments to `qmd query`, `qmd search`, or `qmd vsearch`. Areas overlap and only limit retrieval. They do not duplicate indexed documents or change the query.

## Rules

- Give grounded answers and support claims with retrieved Filoscope sources.
- Read the source document when the user needs facts, decisions, quotes, APIs, specifications, or nuance. Search snippets are only leads.
- Cite canonical source URLs in final answers. Never cite a `qmd://` URL. Use the collection definition in the installed package or repository to find the canonical repository. Convert QMD line positions to source line links when the source is on GitHub.
  - `qmd://filecoin-pay/README.md?index=filoscope:90:14` maps to `https://github.com/FilOzone/filecoin-pay/blob/HEAD/README.md#L90-L103`.

## Feedback

If the skill is unclear or a command fails, offer to open a [GitHub issue](https://github.com/davidgasquez/filoscope/issues/new).

Draft the issue first. Include the goal, context, and a short reproduction. Remove secrets and personal information. Show the draft to the user, and submit it only after approval.
