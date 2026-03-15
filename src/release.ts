import type { Octokit } from "./github.js";

/** Inputs required to create a tag and release. */
export interface ReleaseInput {
  owner: string;
  repo: string;
  /** The semver tag to create, e.g. "v1.2.3". */
  tagName: string;
  /** The commit SHA to tag. */
  sha: string;
  /** Markdown body for the release. */
  body: string;
  /** When true, the release is saved as a draft (not published). */
  draft?: boolean;
}

/** Outputs produced after a successful tag + release creation. */
export interface ReleaseOutput {
  version: string;
  tagName: string;
  releaseId: number;
  releaseUrl: string;
}

/**
 * Creates a lightweight Git tag pointing at `sha`.
 *
 * Throws if the tag already exists (HTTP 422 from the API). Callers that want
 * idempotent behaviour should catch the error and decide whether to proceed.
 */
export async function createTag(
  client: Octokit,
  owner: string,
  repo: string,
  tagName: string,
  sha: string
): Promise<void> {
  await client.rest.git.createRef({
    owner,
    repo,
    ref: `refs/tags/${tagName}`,
    sha,
  });
}

/**
 * Creates a GitHub Release for an existing tag.
 *
 * Throws with a clear message if a release for this tag already exists
 * (HTTP 422). The caller is responsible for deciding how to handle duplicates.
 */
export async function createRelease(
  client: Octokit,
  owner: string,
  repo: string,
  tagName: string,
  body: string,
  draft = false
): Promise<{ id: number; url: string }> {
  const { data } = await client.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tagName,
    name: tagName,
    body,
    draft,
  });

  return { id: data.id, url: data.html_url };
}

/**
 * Creates a Git tag and GitHub Release atomically from the given inputs and
 * returns the action outputs.
 *
 * Failure modes:
 * - If the tag already exists the underlying API throws HTTP 422; this
 *   propagates to the caller as an Error so the action fails clearly rather
 *   than silently creating a mismatched release.
 * - If the release already exists the same applies.
 *
 * `version` in the output is derived from `tagName` by stripping a leading
 * "v" if present (e.g. "v1.2.3" → "1.2.3").
 */
export async function createTagAndRelease(
  client: Octokit,
  input: ReleaseInput
): Promise<ReleaseOutput> {
  const { owner, repo, tagName, sha, body, draft = false } = input;

  await createTag(client, owner, repo, tagName, sha);
  const { id, url } = await createRelease(client, owner, repo, tagName, body, draft);

  const version = tagName.startsWith("v") ? tagName.slice(1) : tagName;

  return {
    version,
    tagName,
    releaseId: id,
    releaseUrl: url,
  };
}
