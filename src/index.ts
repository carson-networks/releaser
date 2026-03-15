import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseBumpType, getNextVersion } from "./version.js";
import { createClient, getReleaseContext } from "./github.js";
import { generateChangelog } from "./changelog.js";
import { createTagAndRelease } from "./release.js";

async function run(): Promise<void> {
  const token = core.getInput("github_token", { required: true });
  const defaultBumpRaw = core.getInput("default_bump") || "patch";
  const refInput = core.getInput("ref");
  const baseBranch = core.getInput("base_branch") || "master";
  const draftRelease = core.getInput("draft_release") === "true";

  const defaultBump = parseBumpType(defaultBumpRaw);
  if (defaultBump === null) {
    core.setFailed(
      `Invalid default_bump value: "${defaultBumpRaw}". Must be one of: patch, minor, major, none.`
    );
    return;
  }

  const { owner, repo } = github.context.repo;
  const sha = refInput || github.context.sha;

  const client = createClient(token);

  const ctx = await getReleaseContext(client, owner, repo, defaultBump, baseBranch);

  if (ctx.bump === "none") {
    core.info("Bump is none — skipping tag and release creation.");
    return;
  }

  const tagName = getNextVersion(ctx.latestTag, ctx.bump);
  if (tagName === null) {
    core.setFailed("Failed to compute next version.");
    return;
  }

  const body = generateChangelog(ctx.mergedPRs);

  core.info(`Creating tag ${tagName} at ${sha}`);
  const result = await createTagAndRelease(client, {
    owner,
    repo,
    tagName,
    sha,
    body,
    draft: draftRelease,
  });

  core.setOutput("version", result.version);
  core.setOutput("tag_name", result.tagName);
  core.setOutput("release_id", String(result.releaseId));
  core.setOutput("release_url", result.releaseUrl);

  core.info(`Released ${result.tagName}: ${result.releaseUrl}`);
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
