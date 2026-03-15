import { getOctokit } from "@actions/github";
import semver from "semver";
import { parseTag, resolveBump, resolveBumpFromLabels } from "./version.js";
import type { BumpType } from "./version.js";

export type Octokit = ReturnType<typeof getOctokit>;

/** A merged PR relevant to the release. */
export interface PR {
  number: number;
  title: string;
  url: string;
  author: string;
  labels: string[];
}

/** Result of resolving the next release from the repository state. */
export interface ReleaseContext {
  /** The latest semver tag found, or null if none exists. */
  latestTag: string | null;
  /** PRs merged since the latest tag (or all time if no tag). */
  mergedPRs: PR[];
  /** The effective bump type after applying labels and default. */
  bump: BumpType;
}

/**
 * Returns an authenticated Octokit client.
 */
export function createClient(token: string): Octokit {
  return getOctokit(token);
}

/**
 * Fetches all tags from the repo and returns the highest valid semver tag
 * (e.g. "v1.2.3"), or null if none exist.
 *
 * The GitHub API returns tags sorted by commit date descending — NOT by
 * semver — so the highest version could appear on any page. We must walk
 * every page before we can be certain we have the global maximum.
 * `client.paginate` fetches all pages, guaranteeing no tag is missed.
 */
export async function getLatestSemverTag(
  client: Octokit,
  owner: string,
  repo: string
): Promise<string | null> {
  // All pages are fetched here — the highest semver tag is not guaranteed
  // to appear first because the API orders by commit date, not version.
  const tags = await client.paginate(client.rest.repos.listTags, {
    owner,
    repo,
    per_page: 100,
  });

  let latest: string | null = null;

  for (const tag of tags) {
    const parsed = parseTag(tag.name);
    if (parsed === null) continue;
    if (latest === null || semver.gt(parsed, parseTag(latest)!)) {
      latest = tag.name;
    }
  }

  return latest;
}

/**
 * Returns the ISO timestamp of a tag's commit, or null if it cannot be
 * determined. Used to filter PRs merged after the tag.
 */
async function getTagCommitDate(
  client: Octokit,
  owner: string,
  repo: string,
  tag: string
): Promise<string | null> {
  try {
    const { data: ref } = await client.rest.git.getRef({
      owner,
      repo,
      ref: `tags/${tag}`,
    });

    // Lightweight tag: ref points directly to a commit
    if (ref.object.type === "commit") {
      const { data: commit } = await client.rest.git.getCommit({
        owner,
        repo,
        commit_sha: ref.object.sha,
      });
      return commit.committer.date;
    }

    // Annotated tag: ref points to a tag object
    const { data: tagObj } = await client.rest.git.getTag({
      owner,
      repo,
      tag_sha: ref.object.sha,
    });
    return tagObj.tagger.date;
  } catch {
    return null;
  }
}

/**
 * Returns PRs that were merged into `baseBranch` after `since` (ISO date
 * string). If `since` is null, returns all merged PRs on that branch.
 *
 * Results are ordered oldest-merged-first for changelog readability.
 *
 * Implementation notes:
 * - We pass `base: baseBranch` so the API filters server-side; only PRs
 *   whose target branch is `baseBranch` are returned.
 * - We sort by `created` (immutable) rather than `updated`. A PR's
 *   `updated_at` changes whenever it is edited, commented on, or labelled —
 *   including after it is merged — so sorting by it would give a misleading
 *   ordering and make cutoff logic incorrect.
 * - We do NOT attempt early termination. The REST API offers no
 *   `merged_at` sort, so we cannot infer from position in the result set
 *   that subsequent pages contain only older merges. A PR opened before
 *   `since` may have sat open and been merged well after it. We therefore
 *   fetch all pages and filter by `merged_at` in process.
 */
export async function getMergedPRsSince(
  client: Octokit,
  owner: string,
  repo: string,
  since: string | null,
  baseBranch = "master"
): Promise<PR[]> {
  const sinceDate = since ? new Date(since) : null;

  // base: baseBranch is enforced server-side by the API.
  // sort: "created" uses an immutable timestamp; updated_at is not safe
  // to sort on because it reflects post-merge edits, not merge order.
  const pulls = await client.paginate(client.rest.pulls.list, {
    owner,
    repo,
    state: "closed",
    base: baseBranch,
    sort: "created",
    direction: "desc",
    per_page: 100,
  });

  const interim: { pr: PR; mergedAt: Date }[] = [];

  for (const raw of pulls) {
    // Closed but not merged (e.g. declined PRs).
    if (!raw.merged_at) continue;

    // merged_at is the authoritative timestamp for when the PR landed;
    // we never use updated_at here.
    const mergedAt = new Date(raw.merged_at);
    if (sinceDate && mergedAt <= sinceDate) continue;

    interim.push({
      pr: {
        number: raw.number,
        title: raw.title,
        url: raw.html_url,
        author: raw.user?.login ?? "unknown",
        labels: raw.labels.map((l) =>
          typeof l === "string" ? l : (l.name ?? "")
        ),
      },
      mergedAt,
    });
  }

  return interim
    .sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())
    .map((item) => item.pr);
}

/**
 * Resolves the full release context for a repository:
 * - Finds the latest semver tag.
 * - Fetches PRs merged into `baseBranch` since that tag.
 * - Determines the effective bump from PR labels + defaultBump.
 */
export async function getReleaseContext(
  client: Octokit,
  owner: string,
  repo: string,
  defaultBump: BumpType,
  baseBranch = "master"
): Promise<ReleaseContext> {
  const latestTag = await getLatestSemverTag(client, owner, repo);

  const since = latestTag
    ? await getTagCommitDate(client, owner, repo, latestTag)
    : null;

  const mergedPRs = await getMergedPRsSince(
    client,
    owner,
    repo,
    since,
    baseBranch
  );

  const allLabels = mergedPRs.flatMap((pr) => pr.labels);
  const fromLabels = resolveBumpFromLabels(allLabels);
  const bump = resolveBump(allLabels, defaultBump);

  void fromLabels;

  return { latestTag, mergedPRs, bump };
}
