import semver from "semver";

/** Bump type for version increments. */
export enum BumpType {
  Major = "major",
  Minor = "minor",
  Patch = "patch",
  None = "none",
}

/** Release label to bump type mapping. */
const labelToBump: Record<string, BumpType> = {
  "release:major": BumpType.Major,
  "release:minor": BumpType.Minor,
  "release:patch": BumpType.Patch,
};

/** Bump precedence for "highest wins" (major > minor > patch). */
const bumpOrder: Record<BumpType, number> = {
  [BumpType.None]: 0,
  [BumpType.Patch]: 1,
  [BumpType.Minor]: 2,
  [BumpType.Major]: 3,
};

/**
 * Resolves the highest bump from an array of PR labels.
 * Returns null if no release labels are present.
 */
export function resolveBumpFromLabels(labels: string[]): BumpType | null {
  let highest: BumpType | null = null;

  for (const label of labels) {
    const bump = labelToBump[label];
    if (bump) {
      if (highest === null || bumpOrder[bump] > bumpOrder[highest]) {
        highest = bump;
      }
    }
  }

  return highest;
}

/**
 * Resolves the effective bump from labels, falling back to default when no
 * release labels are present.
 */
export function resolveBump(labels: string[], defaultBump: BumpType): BumpType {
  const fromLabels = resolveBumpFromLabels(labels);
  return fromLabels ?? defaultBump;
}

/**
 * Parses a tag string (e.g. "v1.2.3" or "1.2.3") into a valid semver string.
 * Returns null for invalid or missing tags.
 */
export function parseTag(tag: string | null | undefined): string | null {
  if (tag == null || tag.trim() === "") {
    return null;
  }
  const cleaned = tag.startsWith("v") ? tag.slice(1) : tag;
  return semver.valid(cleaned);
}

/**
 * Parses a raw string (e.g. from action inputs) into a BumpType.
 * Returns null for unrecognised values.
 */
export function parseBumpType(value: string): BumpType | null {
  const normalised = value.trim().toLowerCase();
  return (Object.values(BumpType) as string[]).includes(normalised)
    ? (normalised as BumpType)
    : null;
}

/**
 * Computes the next version from a previous tag and bump type.
 * - If bump is "none", returns null.
 * - If previousTag is null (first release), derives from default: patch→v0.0.1,
 *   minor→v0.1.0, major→v1.0.0.
 * - If previousTag is invalid, returns null.
 */
export function getNextVersion(
  previousTag: string | null | undefined,
  bump: BumpType
): string | null {
  if (bump === BumpType.None) {
    return null;
  }

  if (previousTag == null || previousTag.trim() === "") {
    // First release
    switch (bump) {
      case BumpType.Patch:
        return "v0.0.1";
      case BumpType.Minor:
        return "v0.1.0";
      case BumpType.Major:
        return "v1.0.0";
      default:
        bump satisfies never;
        return null;
    }
  }

  const parsed = parseTag(previousTag);
  if (parsed === null) {
    return null;
  }

  const next = semver.inc(parsed, bump);
  return next ? `v${next}` : null;
}
