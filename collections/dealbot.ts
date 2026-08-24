import { github } from "../src/connectors/github.ts";

export default github({
  name: "dealbot",
  context: "TypeScript monorepo for Deal Bot, an automated Filecoin PDP deal creation and performance monitoring system, covering NestJS backend APIs and workers, pg-boss scheduling, provider checks, retrieval testing, metrics, Postgres persistence, Synapse wallet and contract integration, Graph Protocol subgraph indexing, React/Vite dashboard, deployment docs, runbooks, and production operations.",
  repository: "FilOzone/dealbot",
  include: "**/*.{md,ts,tsx,js,sql,json,yml,yaml}",
});
