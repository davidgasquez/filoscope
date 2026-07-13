#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

const [source, destinationArg] = process.argv.slice(2);
if (!source || !destinationArg) {
  console.error("Usage: node connectors/github.js <owner/repo> <destination>");
  process.exit(1);
}

const match = source.match(/^([^/]+)\/([^/]+)$/);
if (!match) throw new Error(`GitHub source must be owner/repo: ${source}`);

const destination = path.resolve(process.cwd(), destinationArg);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const response = await fetch(`https://api.github.com/repos/${match[1]}/${match[2]}/tarball`, {
  headers: {
    "accept": "application/vnd.github+json",
    "user-agent": "filoscope-github-connector",
    ...(token ? { "authorization": `Bearer ${token}` } : {}),
  },
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`GitHub archive download failed: ${response.status} ${response.statusText}: ${body}`);
}
if (!response.body) throw new Error("GitHub archive download returned an empty body");

await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(destination, { recursive: true });
await pipeline(Readable.fromWeb(response.body), tar.x({ cwd: destination, strip: 1 }));
