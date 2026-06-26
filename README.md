# filoscope

Search Filecoin docs and code from a prebuilt QMD index.

`filoscope` is a small `npx` CLI for grounded Filecoin ecosystem search without cloning every source repo. It downloads the latest compressed SQLite index from this repo's GitHub Releases, stores it where QMD expects a named index, and queries it through the QMD SDK.

## Use

```bash
npx filoscope pull
npx filoscope status
npx filoscope search '"FIP-0081"' -c fips -n 5
npx filoscope query "how does Filecoin storage power work"
npx filoscope get '#4cb064:1:40'
```

Use `search` for exact terms and `query` for broader questions. Fetch source text with `get` before making claims.

Useful commands:

```bash
npx filoscope search '"daily_network_activity_by_method"' -c fdp -n 10
npx filoscope query -c fdp $'intent: Find how an FDP dataset is built.\nlex: raw model main materialize asset schema test\nvec: where the portal defines and validates this dataset'
npx filoscope multi-get 'fips/FIPS/*.md' -l 80 --format md
```

## Cache

Default cache paths:

```text
$XDG_CACHE_HOME/qmd/filoscope.sqlite
~/.cache/qmd/filoscope.sqlite
```

`filoscope` also writes `filoscope.release-tag.txt` beside the DB and a QMD config sidecar at:

```text
$XDG_CONFIG_HOME/qmd/filoscope.yml
~/.config/qmd/filoscope.yml
```

That makes the same index usable with QMD:

```bash
qmd --index filoscope search '"FIP-0081"' -c fips -n 5
```

## Local Development

```bash
npm install
node bin/filoscope.js --help
```

Use an existing local build index:

```bash
mkdir -p /tmp/filoscope-cache/qmd
cp .qmd/index.sqlite /tmp/filoscope-cache/qmd/filoscope.sqlite
printf 'manual-local\n' > /tmp/filoscope-cache/qmd/filoscope.release-tag.txt
XDG_CACHE_HOME=/tmp/filoscope-cache node bin/filoscope.js status
```

## Build The Index

The source collections are git submodules under `collections/`, and `.qmd/index.yml` is the QMD config.

```bash
make init
make update
make index
make release
```

`make release` writes `dist/filoscope.sqlite.gz`.

## Release

`.github/workflows/build-index.yml` runs daily and supports manual dispatch. It restores the latest release index, updates it, rejects incomplete embeddings, uploads a workflow artifact, and publishes `filoscope.sqlite.gz` to the `index-YYYY-MM-DD` GitHub Release.

The npm package is published separately:

```bash
npm publish --access public
```
