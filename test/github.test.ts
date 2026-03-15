import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLatestSemverTag,
  getMergedPRsSince,
  getReleaseContext,
  type Octokit,
  type PR,
} from "../src/github.js";
import { BumpType } from "../src/version.js";

// ---------------------------------------------------------------------------
// Helpers to build minimal Octokit mock shapes
// ---------------------------------------------------------------------------

function makePR(
  overrides: Partial<{
    number: number;
    title: string;
    html_url: string;
    merged_at: string | null;
    user: { login: string } | null;
    labels: { name: string }[];
  }> = {}
) {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Fix bug",
    html_url: overrides.html_url ?? "https://github.com/owner/repo/pull/1",
    merged_at:
      "merged_at" in overrides ? overrides.merged_at : "2024-02-01T00:00:00Z",
    user: overrides.user !== undefined ? overrides.user : { login: "alice" },
    labels: overrides.labels ?? [],
  };
}

function makeClient(overrides: {
  listTags?: object[];
  getRef?: object;
  getCommit?: object;
  getTag?: object;
  listPulls?: object[];
}): Octokit {
  // Both getLatestSemverTag and getMergedPRsSince use client.paginate (not
  // paginate.iterator), so a single paginate mock handles both.
  const paginateFn = vi.fn((endpoint: unknown) => {
    if (endpoint === "repos.listTags")
      return Promise.resolve(overrides.listTags ?? []);
    if (endpoint === "pulls.list")
      return Promise.resolve(overrides.listPulls ?? []);
    return Promise.resolve([]);
  });

  const paginate = Object.assign(paginateFn, {
    // iterator is no longer used; kept as a no-op so accidental calls surface.
    iterator: vi.fn(),
  });

  return {
    paginate,
    rest: {
      repos: { listTags: "repos.listTags" },
      pulls: { list: "pulls.list" },
      git: {
        getRef: vi.fn().mockResolvedValue(
          overrides.getRef ?? {
            data: { object: { type: "commit", sha: "abc" } },
          }
        ),
        getCommit: vi.fn().mockResolvedValue(
          overrides.getCommit ?? {
            data: { committer: { date: "2024-01-15T00:00:00Z" } },
          }
        ),
        getTag: vi.fn().mockResolvedValue(
          overrides.getTag ?? {
            data: { tagger: { date: "2024-01-15T00:00:00Z" } },
          }
        ),
      },
    },
  } as unknown as Octokit;
}

// ---------------------------------------------------------------------------
// getLatestSemverTag
// ---------------------------------------------------------------------------

describe("getLatestSemverTag", () => {
  it("returns null when there are no tags", async () => {
    const client = makeClient({ listTags: [] });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBeNull();
  });

  it("returns the single valid semver tag", async () => {
    const client = makeClient({ listTags: [{ name: "v1.2.3" }] });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBe("v1.2.3");
  });

  it("returns the highest semver tag", async () => {
    const client = makeClient({
      listTags: [{ name: "v1.0.0" }, { name: "v1.2.3" }, { name: "v1.1.0" }],
    });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBe("v1.2.3");
  });

  it("ignores non-semver tags", async () => {
    const client = makeClient({
      listTags: [{ name: "latest" }, { name: "v1.0.0" }, { name: "release" }],
    });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBe("v1.0.0");
  });

  it("returns null when all tags are non-semver", async () => {
    const client = makeClient({
      listTags: [{ name: "latest" }, { name: "stable" }],
    });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBeNull();
  });

  it("handles tags without v prefix", async () => {
    const client = makeClient({
      listTags: [{ name: "1.0.0" }, { name: "2.0.0" }],
    });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBe("2.0.0");
  });

  it("finds the highest semver even when a lower version appears first", async () => {
    // Simulates tags returned in commit-date order (not semver order),
    // confirming the full scan is required.
    const client = makeClient({
      listTags: [{ name: "v1.9.0" }, { name: "v2.0.0" }, { name: "v0.1.0" }],
    });
    expect(await getLatestSemverTag(client, "owner", "repo")).toBe("v2.0.0");
  });
});

// ---------------------------------------------------------------------------
// getMergedPRsSince
// ---------------------------------------------------------------------------

describe("getMergedPRsSince", () => {
  it("returns empty array when no PRs exist", async () => {
    const client = makeClient({ listPulls: [] });
    expect(await getMergedPRsSince(client, "owner", "repo", null)).toEqual([]);
  });

  it("excludes closed-but-not-merged PRs", async () => {
    const client = makeClient({
      listPulls: [makePR({ merged_at: null })],
    });
    expect(await getMergedPRsSince(client, "owner", "repo", null)).toEqual([]);
  });

  it("returns all merged PRs when since is null", async () => {
    const client = makeClient({
      listPulls: [
        makePR({ number: 1, merged_at: "2024-01-01T00:00:00Z" }),
        makePR({ number: 2, merged_at: "2024-02-01T00:00:00Z" }),
      ],
    });
    const prs = await getMergedPRsSince(client, "owner", "repo", null);
    expect(prs).toHaveLength(2);
  });

  it("excludes PRs merged before or at the since date", async () => {
    const client = makeClient({
      listPulls: [
        makePR({ number: 1, merged_at: "2024-01-01T00:00:00Z" }), // before → excluded
        makePR({ number: 2, merged_at: "2024-01-15T00:00:00Z" }), // equal to since → excluded
        makePR({ number: 3, merged_at: "2024-02-01T00:00:00Z" }), // after → included
      ],
    });
    const prs = await getMergedPRsSince(
      client,
      "owner",
      "repo",
      "2024-01-15T00:00:00Z"
    );
    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(3);
  });

  it("maps PR fields correctly, using merged_at not updated_at", async () => {
    const client = makeClient({
      listPulls: [
        makePR({
          number: 42,
          title: "Add feature",
          html_url: "https://github.com/owner/repo/pull/42",
          merged_at: "2024-02-01T00:00:00Z",
          user: { login: "bob" },
          labels: [{ name: "release:minor" }, { name: "enhancement" }],
        }),
      ],
    });
    const prs = await getMergedPRsSince(client, "owner", "repo", null);
    expect(prs).toHaveLength(1);
    const pr: PR = prs[0];
    expect(pr.number).toBe(42);
    expect(pr.title).toBe("Add feature");
    expect(pr.url).toBe("https://github.com/owner/repo/pull/42");
    expect(pr.author).toBe("bob");
    expect(pr.labels).toEqual(["release:minor", "enhancement"]);
  });

  it("uses 'unknown' when PR user is null", async () => {
    const client = makeClient({
      listPulls: [makePR({ user: null })],
    });
    const [pr] = await getMergedPRsSince(client, "owner", "repo", null);
    expect(pr.author).toBe("unknown");
  });

  it("returns PRs in ascending merge order", async () => {
    const client = makeClient({
      listPulls: [
        makePR({ number: 3, merged_at: "2024-03-01T00:00:00Z" }),
        makePR({ number: 1, merged_at: "2024-01-01T00:00:00Z" }),
        makePR({ number: 2, merged_at: "2024-02-01T00:00:00Z" }),
      ],
    });
    const prs = await getMergedPRsSince(client, "owner", "repo", null);
    expect(prs.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("passes base branch to the API so only PRs targeting that branch are returned", async () => {
    // base-branch filtering is enforced server-side; here we confirm the
    // `base` param is forwarded to `paginate` by checking the call args.
    const client = makeClient({ listPulls: [] });
    await getMergedPRsSince(client, "owner", "repo", null, "main");
    const [, callArgs] = (client.paginate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs).toMatchObject({ base: "main" });
  });

  it("defaults baseBranch to master", async () => {
    const client = makeClient({ listPulls: [] });
    await getMergedPRsSince(client, "owner", "repo", null);
    const [, callArgs] = (client.paginate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs).toMatchObject({ base: "master" });
  });

  it("sorts by created not updated so post-merge edits do not affect ordering", async () => {
    const client = makeClient({ listPulls: [] });
    await getMergedPRsSince(client, "owner", "repo", null);
    const [, callArgs] = (client.paginate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(callArgs).toMatchObject({ sort: "created" });
  });
});

// ---------------------------------------------------------------------------
// getReleaseContext
// ---------------------------------------------------------------------------

describe("getReleaseContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null latestTag and all PRs when no tags exist", async () => {
    const client = makeClient({
      listTags: [],
      listPulls: [makePR({ number: 1, labels: [{ name: "release:patch" }] })],
    });
    const ctx = await getReleaseContext(
      client,
      "owner",
      "repo",
      BumpType.Patch
    );
    expect(ctx.latestTag).toBeNull();
    expect(ctx.mergedPRs).toHaveLength(1);
  });

  it("uses label bump when labels are present", async () => {
    const client = makeClient({
      listTags: [],
      listPulls: [makePR({ labels: [{ name: "release:minor" }] })],
    });
    const ctx = await getReleaseContext(
      client,
      "owner",
      "repo",
      BumpType.Patch
    );
    expect(ctx.bump).toBe(BumpType.Minor);
  });

  it("falls back to defaultBump when no release labels", async () => {
    const client = makeClient({
      listTags: [],
      listPulls: [makePR({ labels: [{ name: "bug" }] })],
    });
    const ctx = await getReleaseContext(
      client,
      "owner",
      "repo",
      BumpType.Major
    );
    expect(ctx.bump).toBe(BumpType.Major);
  });

  it("returns none bump when defaultBump is none and no labels", async () => {
    const client = makeClient({ listTags: [], listPulls: [] });
    const ctx = await getReleaseContext(client, "owner", "repo", BumpType.None);
    expect(ctx.bump).toBe(BumpType.None);
  });

  it("sets latestTag from highest semver tag", async () => {
    const client = makeClient({
      listTags: [{ name: "v1.0.0" }, { name: "v2.0.0" }],
      listPulls: [],
      getRef: { data: { object: { type: "commit", sha: "abc" } } },
      getCommit: { data: { committer: { date: "2024-01-15T00:00:00Z" } } },
    });
    const ctx = await getReleaseContext(
      client,
      "owner",
      "repo",
      BumpType.Patch
    );
    expect(ctx.latestTag).toBe("v2.0.0");
  });

  it("uses highest bump across all PR labels", async () => {
    const client = makeClient({
      listTags: [],
      listPulls: [
        makePR({ number: 1, labels: [{ name: "release:patch" }] }),
        makePR({ number: 2, labels: [{ name: "release:minor" }] }),
        makePR({ number: 3, labels: [{ name: "release:patch" }] }),
      ],
    });
    const ctx = await getReleaseContext(
      client,
      "owner",
      "repo",
      BumpType.Patch
    );
    expect(ctx.bump).toBe(BumpType.Minor);
  });

  it("forwards baseBranch to getMergedPRsSince", async () => {
    const client = makeClient({ listTags: [], listPulls: [] });
    await getReleaseContext(client, "owner", "repo", BumpType.Patch, "main");
    // The pulls.list call should have received base: "main"
    const pullsCall = (
      client.paginate as ReturnType<typeof vi.fn>
    ).mock.calls.find(([endpoint]: [unknown]) => endpoint === "pulls.list");
    expect(pullsCall).toBeDefined();
    expect(pullsCall![1]).toMatchObject({ base: "main" });
  });
});
