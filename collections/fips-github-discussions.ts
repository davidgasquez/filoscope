import { githubDiscussion } from "../src/connectors/github-discussion.ts";

export default githubDiscussion({
  name: "fips-github-discussions",
  context: "GitHub Discussions from the Filecoin FIPs repository",
  repository: "filecoin-project/FIPs",
});
