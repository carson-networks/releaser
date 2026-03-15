import { describe, it, expect } from "vitest";
import {
  BumpType,
  resolveBumpFromLabels,
  resolveBump,
  parseTag,
  getNextVersion,
  parseBumpType,
} from "../src/version.js";

describe("resolveBumpFromLabels", () => {
  it("returns null for empty labels", () => {
    expect(resolveBumpFromLabels([])).toBeNull();
  });

  it("returns null when no release labels present", () => {
    expect(resolveBumpFromLabels(["bug", "documentation"])).toBeNull();
  });

  it("returns patch for release:patch", () => {
    expect(resolveBumpFromLabels(["release:patch"])).toBe(BumpType.Patch);
  });

  it("returns minor for release:minor", () => {
    expect(resolveBumpFromLabels(["release:minor"])).toBe(BumpType.Minor);
  });

  it("returns major for release:major", () => {
    expect(resolveBumpFromLabels(["release:major"])).toBe(BumpType.Major);
  });

  it("returns highest bump when multiple labels on same PR", () => {
    expect(
      resolveBumpFromLabels(["release:patch", "release:minor", "release:major"])
    ).toBe(BumpType.Major);
    expect(resolveBumpFromLabels(["release:patch", "release:minor"])).toBe(
      BumpType.Minor
    );
    expect(resolveBumpFromLabels(["release:patch", "release:major"])).toBe(
      BumpType.Major
    );
  });

  it("returns highest bump across multiple PRs (flattened labels)", () => {
    const labels = ["release:patch", "release:patch", "release:minor"];
    expect(resolveBumpFromLabels(labels)).toBe(BumpType.Minor);
  });
});

describe("resolveBump", () => {
  it("uses label bump when present", () => {
    expect(resolveBump(["release:minor"], BumpType.Patch)).toBe(BumpType.Minor);
  });

  it("falls back to default when no release labels", () => {
    expect(resolveBump([], BumpType.Patch)).toBe(BumpType.Patch);
    expect(resolveBump(["bug"], BumpType.Minor)).toBe(BumpType.Minor);
    expect(resolveBump([], BumpType.Major)).toBe(BumpType.Major);
    expect(resolveBump([], BumpType.None)).toBe(BumpType.None);
  });

  it("label bump wins even when default is none", () => {
    expect(resolveBump(["release:patch"], BumpType.None)).toBe(BumpType.Patch);
    expect(resolveBump(["release:minor"], BumpType.None)).toBe(BumpType.Minor);
  });
});

describe("parseTag", () => {
  it("parses v-prefixed tags", () => {
    expect(parseTag("v1.2.3")).toBe("1.2.3");
    expect(parseTag("v0.0.1")).toBe("0.0.1");
  });

  it("parses tags without v prefix", () => {
    expect(parseTag("1.2.3")).toBe("1.2.3");
  });

  it("returns null for null or undefined", () => {
    expect(parseTag(null)).toBeNull();
    expect(parseTag(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTag("")).toBeNull();
    expect(parseTag("   ")).toBeNull();
  });

  it("returns null for invalid tags", () => {
    expect(parseTag("not-a-version")).toBeNull();
    expect(parseTag("v1.2.3.4.5")).toBeNull();
    expect(parseTag("v1")).toBeNull();
  });
});

describe("getNextVersion", () => {
  it("returns null when bump is none", () => {
    expect(getNextVersion("v1.2.3", BumpType.None)).toBeNull();
    expect(getNextVersion(null, BumpType.None)).toBeNull();
  });

  it("first release: patch → v0.0.1", () => {
    expect(getNextVersion(null, BumpType.Patch)).toBe("v0.0.1");
    expect(getNextVersion("", BumpType.Patch)).toBe("v0.0.1");
    expect(getNextVersion("   ", BumpType.Patch)).toBe("v0.0.1");
  });

  it("first release: minor → v0.1.0", () => {
    expect(getNextVersion(null, BumpType.Minor)).toBe("v0.1.0");
  });

  it("first release: major → v1.0.0", () => {
    expect(getNextVersion(null, BumpType.Major)).toBe("v1.0.0");
  });

  it("increments patch from valid tag", () => {
    expect(getNextVersion("v1.2.3", BumpType.Patch)).toBe("v1.2.4");
    expect(getNextVersion("1.2.3", BumpType.Patch)).toBe("v1.2.4");
  });

  it("increments minor from valid tag", () => {
    expect(getNextVersion("v1.2.3", BumpType.Minor)).toBe("v1.3.0");
  });

  it("increments major from valid tag", () => {
    expect(getNextVersion("v1.2.3", BumpType.Major)).toBe("v2.0.0");
  });

  it("returns null for invalid previous tag", () => {
    expect(getNextVersion("invalid", BumpType.Patch)).toBeNull();
    expect(getNextVersion("v1.2.3.4", BumpType.Patch)).toBeNull();
  });
});

describe("parseBumpType", () => {
  it("parses valid bump types", () => {
    expect(parseBumpType("patch")).toBe(BumpType.Patch);
    expect(parseBumpType("minor")).toBe(BumpType.Minor);
    expect(parseBumpType("major")).toBe(BumpType.Major);
    expect(parseBumpType("none")).toBe(BumpType.None);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseBumpType("PATCH")).toBe(BumpType.Patch);
    expect(parseBumpType("  Minor  ")).toBe(BumpType.Minor);
    expect(parseBumpType("MAJOR")).toBe(BumpType.Major);
    expect(parseBumpType("  NONE  ")).toBe(BumpType.None);
  });

  it("returns null for unrecognised values", () => {
    expect(parseBumpType("")).toBeNull();
    expect(parseBumpType("hotfix")).toBeNull();
    expect(parseBumpType("release:minor")).toBeNull();
  });
});
