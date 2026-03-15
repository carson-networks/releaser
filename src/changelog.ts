import type { PR } from "./github.js";

/**
 * Characters that have special meaning in Markdown and need escaping when
 * they appear in user-supplied text (PR titles, author names).
 *
 * We escape a conservative set: characters that can alter inline formatting
 * or link syntax. Backticks, asterisks, underscores, tildes, square brackets,
 * angle brackets, and backslashes are the primary culprits.
 */
const MARKDOWN_SPECIAL = /([\\`*_{}[\]<>#+\-!|])/g;

/**
 * Escapes Markdown special characters in a plain-text string so it renders
 * literally in the release body.
 */
export function escapeMd(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, "\\$1");
}

/**
 * Formats a single PR as one changelog line:
 *   - <title> ([#<number>](<url>)) by @<author>
 */
export function formatPRLine(pr: PR): string {
  const title = escapeMd(pr.title);
  const author = escapeMd(pr.author);
  return `- ${title} ([#${pr.number}](${pr.url})) by @${author}`;
}

/**
 * Generates a Markdown release body from a list of merged PRs.
 *
 * Format:
 *   ## What's Changed
 *   - <title> ([#<number>](<url>)) by @<author>
 *   ...
 *
 * If the PR list is empty, a "No changes" note is included instead of the
 * PR list. Callers should still choose whether to publish such a release.
 */
export function generateChangelog(prs: PR[]): string {
  const header = "## What's Changed";

  if (prs.length === 0) {
    return `${header}\n\nNo changes.`;
  }

  const lines = prs.map(formatPRLine).join("\n");
  return `${header}\n\n${lines}`;
}
