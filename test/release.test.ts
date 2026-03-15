import { describe, it, expect, vi } from "vitest";
import {
  createTag,
  createRelease,
  createTagAndRelease,
} from "../src/release.js";
import type { Octokit } from "../src/github.js";
import type { ReleaseInput } from "../src/release.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(
  overrides: {
    createRef?: () => Promise<unknown>;
    createRelease?: () => Promise<{ data: { id: number; html_url: string } }>;
  } = {}
): Octokit {
  return {
    rest: {
      git: {
        createRef: vi.fn(
          overrides.createRef ?? (() => Promise.resolve({ data: {} }))
        ),
      },
      repos: {
        createRelease: vi.fn(
          overrides.createRelease ??
            (() =>
              Promise.resolve({
                data: {
                  id: 1,
                  html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
                },
              }))
        ),
      },
    },
  } as unknown as Octokit;
}

function makeInput(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    owner: overrides.owner ?? "owner",
    repo: overrides.repo ?? "repo",
    tagName: overrides.tagName ?? "v1.2.3",
    sha: overrides.sha ?? "abc123",
    body:
      overrides.body ??
      "## What's Changed\n\n- Fix bug ([#1](https://github.com/owner/repo/pull/1)) by @alice",
    draft: overrides.draft,
  };
}

// ---------------------------------------------------------------------------
// createTag
// ---------------------------------------------------------------------------

describe("createTag", () => {
  it("calls git.createRef with the correct ref and sha", async () => {
    const client = makeClient();
    await createTag(client, "owner", "repo", "v1.2.3", "deadbeef");
    expect(client.rest.git.createRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "refs/tags/v1.2.3",
      sha: "deadbeef",
    });
  });

  it("uses the full refs/tags/ prefix in the ref", async () => {
    const client = makeClient();
    await createTag(client, "owner", "repo", "v2.0.0", "sha");
    const [args] = (client.rest.git.createRef as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(args.ref).toBe("refs/tags/v2.0.0");
  });

  it("propagates errors from the API (e.g. tag already exists)", async () => {
    const err = Object.assign(new Error("Reference already exists"), {
      status: 422,
    });
    const client = makeClient({ createRef: () => Promise.reject(err) });
    await expect(
      createTag(client, "owner", "repo", "v1.0.0", "sha")
    ).rejects.toThrow("Reference already exists");
  });
});

// ---------------------------------------------------------------------------
// createRelease
// ---------------------------------------------------------------------------

describe("createRelease", () => {
  it("calls repos.createRelease with correct parameters", async () => {
    const client = makeClient();
    await createRelease(client, "owner", "repo", "v1.2.3", "body text");
    expect(client.rest.repos.createRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      tag_name: "v1.2.3",
      name: "v1.2.3",
      body: "body text",
      draft: false,
    });
  });

  it("passes draft: true when requested", async () => {
    const client = makeClient();
    await createRelease(client, "owner", "repo", "v1.0.0", "body", true);
    const [args] = (client.rest.repos.createRelease as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(args.draft).toBe(true);
  });

  it("defaults draft to false", async () => {
    const client = makeClient();
    await createRelease(client, "owner", "repo", "v1.0.0", "body");
    const [args] = (client.rest.repos.createRelease as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(args.draft).toBe(false);
  });

  it("returns id and url from the API response", async () => {
    const client = makeClient({
      createRelease: () =>
        Promise.resolve({
          data: {
            id: 42,
            html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
          },
        }),
    });
    const result = await createRelease(
      client,
      "owner",
      "repo",
      "v1.2.3",
      "body"
    );
    expect(result).toEqual({
      id: 42,
      url: "https://github.com/owner/repo/releases/tag/v1.2.3",
    });
  });

  it("propagates errors from the API (e.g. release already exists)", async () => {
    const err = Object.assign(new Error("already_exists"), { status: 422 });
    const client = makeClient({ createRelease: () => Promise.reject(err) });
    await expect(
      createRelease(client, "owner", "repo", "v1.0.0", "body")
    ).rejects.toThrow("already_exists");
  });
});

// ---------------------------------------------------------------------------
// createTagAndRelease
// ---------------------------------------------------------------------------

describe("createTagAndRelease", () => {
  it("returns the correct outputs for a standard tagged release", async () => {
    const client = makeClient({
      createRelease: () =>
        Promise.resolve({
          data: {
            id: 99,
            html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
          },
        }),
    });
    const result = await createTagAndRelease(
      client,
      makeInput({ tagName: "v1.2.3", sha: "abc" })
    );
    expect(result).toEqual({
      version: "1.2.3",
      tagName: "v1.2.3",
      releaseId: 99,
      releaseUrl: "https://github.com/owner/repo/releases/tag/v1.2.3",
    });
  });

  it("strips the leading v from tagName to produce version", async () => {
    const client = makeClient();
    const result = await createTagAndRelease(
      client,
      makeInput({ tagName: "v2.5.0" })
    );
    expect(result.version).toBe("2.5.0");
    expect(result.tagName).toBe("v2.5.0");
  });

  it("does not strip version when tagName has no v prefix", async () => {
    const client = makeClient();
    const result = await createTagAndRelease(
      client,
      makeInput({ tagName: "3.0.0" })
    );
    expect(result.version).toBe("3.0.0");
    expect(result.tagName).toBe("3.0.0");
  });

  it("calls createTag before createRelease", async () => {
    const callOrder: string[] = [];
    const client = makeClient({
      createRef: () => {
        callOrder.push("tag");
        return Promise.resolve({});
      },
      createRelease: () => {
        callOrder.push("release");
        return Promise.resolve({
          data: {
            id: 1,
            html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          },
        });
      },
    });
    await createTagAndRelease(client, makeInput());
    expect(callOrder).toEqual(["tag", "release"]);
  });

  it("passes sha to createTag", async () => {
    const client = makeClient();
    await createTagAndRelease(client, makeInput({ sha: "deadbeef123" }));
    const [args] = (client.rest.git.createRef as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(args.sha).toBe("deadbeef123");
  });

  it("passes body to createRelease", async () => {
    const client = makeClient();
    const body = "## What's Changed\n\n- My change ([#5](https://url)) by @dev";
    await createTagAndRelease(client, makeInput({ body }));
    const [args] = (client.rest.repos.createRelease as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(args.body).toBe(body);
  });

  it("passes draft: true through to createRelease", async () => {
    const client = makeClient();
    await createTagAndRelease(client, makeInput({ draft: true }));
    const [args] = (client.rest.repos.createRelease as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(args.draft).toBe(true);
  });

  it("defaults draft to false", async () => {
    const client = makeClient();
    const input = makeInput();
    delete (input as Partial<ReleaseInput>).draft;
    await createTagAndRelease(client, input);
    const [args] = (client.rest.repos.createRelease as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(args.draft).toBe(false);
  });

  it("propagates tag creation failure without calling createRelease", async () => {
    const err = Object.assign(new Error("Reference already exists"), {
      status: 422,
    });
    const createReleaseFn = vi.fn();
    const client = makeClient({
      createRef: () => Promise.reject(err),
      createRelease: createReleaseFn,
    });
    await expect(createTagAndRelease(client, makeInput())).rejects.toThrow(
      "Reference already exists"
    );
    expect(createReleaseFn).not.toHaveBeenCalled();
  });

  it("propagates release creation failure", async () => {
    const err = Object.assign(new Error("already_exists"), { status: 422 });
    const client = makeClient({ createRelease: () => Promise.reject(err) });
    await expect(createTagAndRelease(client, makeInput())).rejects.toThrow(
      "already_exists"
    );
  });
});
