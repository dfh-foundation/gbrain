/** A GitHub account as the REST API returns it on comments and reviews. */
export interface GitHubUser {
  login: string;
  /** `'Bot'` for GitHub App accounts. */
  type?: string;
}

/**
 * A bot's issue comment over this many UTF-8 bytes renders as a stub under its
 * heading. Reviews and review comments are left alone: AI reviewers post real
 * findings there. Deploy and preview bots post a multi-KB log or table on every
 * push; on one busy org that was roughly half of all rendered bytes, drowning
 * the discussion in retrieval and pushing active PRs past content-sanity's
 * embed-skip limit, which then hid the whole page. Short notices, like an issue
 * tracker's link comment, fit under the limit and stay verbatim.
 */
export const BOT_COMMENT_MAX_BYTES = 1024;

function isBot(user: GitHubUser | null): boolean {
  return user?.type === 'Bot' || (user?.login.endsWith('[bot]') ?? false);
}

/** The stub a large bot comment renders as, or null to render it normally. */
export function botCommentStub(user: GitHubUser | null, body: string): string | null {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (!isBot(user) || bytes <= BOT_COMMENT_MAX_BYTES) return null;
  return `_(bot comment, ${Math.round(bytes / 1024)} KB, omitted)_`;
}

/**
 * A run of consecutive, byte-identical comments from one bot renders once,
 * followed by a count. The size stub judges each comment alone, so it misses a
 * CI bot that posts the same short status on every push: one promotion PR
 * collected 2,253 copies of a 166-byte comment, rendering past content-sanity's
 * embed-skip limit on its own. Only consecutive repeats collapse, so a failure
 * between successes, or a human reply, still breaks the run and stays in order.
 */
export function collapseRepeatedBotComments<T extends { user: GitHubUser | null; body: string; created_at: string }>(
  comments: readonly T[],
): Array<{ comment: T; repeats: number; lastAt: string }> {
  const runs: Array<{ comment: T; repeats: number; lastAt: string }> = [];
  for (const c of comments) {
    const prev = runs.at(-1);
    if (prev && isBot(c.user) && c.user?.login === prev.comment.user?.login && c.body === prev.comment.body) {
      prev.repeats += 1;
      prev.lastAt = c.created_at;
    } else {
      runs.push({ comment: c, repeats: 0, lastAt: c.created_at });
    }
  }
  return runs;
}

/** The line under a collapsed run, or null for a comment posted once. */
export function repeatedBotCommentNote(repeats: number, lastAt: string): string | null {
  if (repeats === 0) return null;
  return `_(posted ${repeats} more ${repeats === 1 ? 'time' : 'times'}, the last at ${lastAt})_`;
}
