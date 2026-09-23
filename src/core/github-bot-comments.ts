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

/** The stub a large bot comment renders as, or null to render it normally. */
export function botCommentStub(user: GitHubUser | null, body: string): string | null {
  const isBot = user?.type === 'Bot' || (user?.login.endsWith('[bot]') ?? false);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (!isBot || bytes <= BOT_COMMENT_MAX_BYTES) return null;
  return `_(bot comment, ${Math.round(bytes / 1024)} KB, omitted)_`;
}
