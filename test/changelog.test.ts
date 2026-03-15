import { describe, it, expect } from "vitest";
import { escapeMd, formatPRLine, generateChangelog } from "../src/changelog.js";
import type { PR } from "../src/github.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? "Fix bug",
    url: overrides.url ?? "https://github.com/owner/repo/pull/1",
    author: overrides.author ?? "alice",
    labels: overrides.labels ?? [],
  };
}

// ---------------------------------------------------------------------------
// escapeMd
// ---------------------------------------------------------------------------

describe("escapeMd", () => {
  it("returns plain text unchanged", () => {
    expect(escapeMd("Hello world")).toBe("Hello world");
  });

  it("escapes backslash", () => {
    expect(escapeMd("foo\\bar")).toBe("foo\\\\bar");
  });

  it("escapes backtick", () => {
    expect(escapeMd("use `code`")).toBe("use \\`code\\`");
  });

  it("escapes asterisk", () => {
    expect(escapeMd("**bold**")).toBe("\\*\\*bold\\*\\*");
  });

  it("escapes underscore", () => {
    expect(escapeMd("_italic_")).toBe("\\_italic\\_");
  });

  it("escapes square brackets", () => {
    expect(escapeMd("[link]")).toBe("\\[link\\]");
  });

  it("escapes angle brackets", () => {
    expect(escapeMd("<tag>")).toBe("\\<tag\\>");
  });

  it("escapes hash", () => {
    expect(escapeMd("# heading")).toBe("\\# heading");
  });

  it("escapes pipe", () => {
    expect(escapeMd("a | b")).toBe("a \\| b");
  });

  it("escapes multiple special characters in a single string", () => {
    expect(escapeMd("**[fix]** `patch`")).toBe(
      "\\*\\*\\[fix\\]\\*\\* \\`patch\\`"
    );
  });

  it("handles an empty string", () => {
    expect(escapeMd("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatPRLine
// ---------------------------------------------------------------------------

describe("formatPRLine", () => {
  it("formats a basic PR line", () => {
    const pr = makePR({
      number: 42,
      title: "Add feature",
      url: "https://github.com/owner/repo/pull/42",
      author: "bob",
    });
    expect(formatPRLine(pr)).toBe(
      "- Add feature ([#42](https://github.com/owner/repo/pull/42)) by @bob"
    );
  });

  it("escapes special characters in the title", () => {
    const pr = makePR({ title: "Fix `null` dereference in **core**" });
    expect(formatPRLine(pr)).toContain(
      "Fix \\`null\\` dereference in \\*\\*core\\*\\*"
    );
  });

  it("escapes special characters in the author name", () => {
    const pr = makePR({ author: "user_name" });
    expect(formatPRLine(pr)).toContain("@user\\_name");
  });

  it("includes PR number as a link", () => {
    const pr = makePR({
      number: 99,
      url: "https://github.com/org/repo/pull/99",
    });
    expect(formatPRLine(pr)).toContain(
      "[#99](https://github.com/org/repo/pull/99)"
    );
  });

  it("prefixes the line with a dash", () => {
    expect(formatPRLine(makePR())).toMatch(/^- /);
  });

  it("uses 'unknown' author correctly when passed", () => {
    const pr = makePR({ author: "unknown" });
    expect(formatPRLine(pr)).toContain("@unknown");
  });
});

// ---------------------------------------------------------------------------
// generateChangelog
// ---------------------------------------------------------------------------

describe("generateChangelog", () => {
  it("produces correct output for an empty PR list", () => {
    expect(generateChangelog([])).toBe("## Merged PRs\n\nNo PRs merged.");
  });

  it("produces correct output for a single PR", () => {
    const pr = makePR({
      number: 5,
      title: "Solo change",
      url: "https://github.com/owner/repo/pull/5",
      author: "dev",
    });
    expect(generateChangelog([pr])).toBe(
      "## Merged PRs\n\n" +
        "- Solo change ([#5](https://github.com/owner/repo/pull/5)) by @dev"
    );
  });

  it("produces correct output for multiple PRs in order", () => {
    const prs = [
      makePR({
        number: 1,
        title: "First",
        url: "https://github.com/owner/repo/pull/1",
        author: "alice",
      }),
      makePR({
        number: 2,
        title: "Second",
        url: "https://github.com/owner/repo/pull/2",
        author: "bob",
      }),
      makePR({
        number: 3,
        title: "Third",
        url: "https://github.com/owner/repo/pull/3",
        author: "carol",
      }),
    ];
    expect(generateChangelog(prs)).toBe(
      "## Merged PRs\n\n" +
        "- First ([#1](https://github.com/owner/repo/pull/1)) by @alice\n" +
        "- Second ([#2](https://github.com/owner/repo/pull/2)) by @bob\n" +
        "- Third ([#3](https://github.com/owner/repo/pull/3)) by @carol"
    );
  });

  it("escapes special characters in PR titles and authors", () => {
    const pr = makePR({
      number: 7,
      title: "Fix [issue] with *stuff*",
      url: "https://github.com/owner/repo/pull/7",
      author: "user_name",
    });
    expect(generateChangelog([pr])).toBe(
      "## Merged PRs\n\n" +
        "- Fix \\[issue\\] with \\*stuff\\* ([#7](https://github.com/owner/repo/pull/7)) by @user\\_name"
    );
  });
});
