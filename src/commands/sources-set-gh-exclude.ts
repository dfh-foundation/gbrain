/**
 * gbrain sources set-gh-exclude <id> <owner/name,...|none>
 *
 * Writes `gh_exclude` on an existing github-kind source: repos the sync never
 * materializes under either scope, and whose pages the next full sweep prunes.
 * Exists because an app installed on every repo in an org (scope=auto) has no
 * other way to keep one confidential repo out of the index, and `sources add`
 * is a one-shot, so a deployment needs a verb it can re-run on every boot.
 *
 * Shaped like set-cr-mode and set-path: loud rejection on a missing source,
 * and the prior value printed so the change is visible and reversible. It
 * rejects an invalid name rather than dropping it, since a typo here would
 * silently leave the repo in scope. Lives in its own module so sources.ts
 * stays under its module-size ceiling.
 */
import type { BrainEngine } from '../core/engine.ts';
import { compileTitleExclude, isValidRepoName } from '../core/github-source.ts';
import { normalizeSourceConfig, parseSourceConfig } from '../core/sources-load.ts';

export async function runSetGhExclude(engine: BrainEngine, args: string[]): Promise<void> {
  const id = args[0];
  const raw = args[1];
  if (!id || raw === undefined) {
    console.error('Usage: gbrain sources set-gh-exclude <id> <owner/name,...|none>');
    console.error('  Repos a github source never syncs; a full sweep prunes their pages.');
    console.error('  Pass "none" or "" to clear the list.');
    process.exit(2);
  }

  const entries = raw === 'none' ? [] : raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const invalid = entries.filter((r) => !isValidRepoName(r));
  if (invalid.length > 0) {
    console.error(`Error: not an owner/name repo: ${invalid.join(', ')}`);
    process.exit(2);
  }
  const exclude = [...new Set(entries)].sort();

  const config = await loadGithubConfig(engine, id);

  const prior = typeof config.gh_exclude === 'string' ? config.gh_exclude : '';
  const next = exclude.join(',');
  if (prior === next) {
    console.log(`Source "${id}" gh_exclude unchanged (${next || 'empty'}).`);
    return;
  }
  if (next) config.gh_exclude = next;
  else delete config.gh_exclude;
  await writeConfig(engine, id, config);
  console.log(`Source "${id}" gh_exclude: ${prior || 'empty'} -> ${next || 'empty'}.`);
  if (next) console.log('  Pages already indexed for these repos are pruned on the next full sweep.');
}

/**
 * gbrain sources set-gh-exclude-titles <id> <regex|none>
 *
 * Writes `gh_exclude_titles`: a case-insensitive regex for issue and PR titles
 * the sync never materializes. A matching item's page is dropped when the
 * sweep or a webhook next sees it, which is how a PR marked privileged after
 * it was indexed leaves search. An uncompilable pattern is rejected here and
 * again at sync time, since indexing past a broken one is the leak.
 */
export async function runSetGhExcludeTitles(engine: BrainEngine, args: string[]): Promise<void> {
  const id = args[0];
  const raw = args[1];
  if (!id || raw === undefined) {
    console.error('Usage: gbrain sources set-gh-exclude-titles <id> <regex|none>');
    console.error('  Issue and PR titles (case-insensitive) a github source never syncs.');
    process.exit(2);
  }
  const next = raw === 'none' ? '' : raw;
  try { compileTitleExclude(next); } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const config = await loadGithubConfig(engine, id);
  const prior = typeof config.gh_exclude_titles === 'string' ? config.gh_exclude_titles : '';
  if (prior === next) {
    console.log(`Source "${id}" gh_exclude_titles unchanged.`);
    return;
  }
  if (next) config.gh_exclude_titles = next;
  else delete config.gh_exclude_titles;
  await writeConfig(engine, id, config);
  // The pattern itself is not echoed: it can name the matter it exists to hide.
  console.log(`Source "${id}" gh_exclude_titles ${next ? 'set' : 'cleared'}.`);
}

async function loadGithubConfig(engine: BrainEngine, id: string): Promise<Record<string, unknown>> {
  const rows = await engine.executeRaw<{ config: unknown }>(
    `SELECT config FROM sources WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (rows.length === 0) {
    console.error(`Error: source "${id}" not found.`);
    console.error(`  Run 'gbrain sources list' to see registered sources.`);
    process.exit(4);
  }
  const config = parseSourceConfig(rows[0]!.config);
  if (config.kind !== 'github') {
    console.error(`Error: source "${id}" is not a github source.`);
    process.exit(3);
  }
  return config;
}

async function writeConfig(engine: BrainEngine, id: string, config: Record<string, unknown>): Promise<void> {
  await engine.executeRaw(
    `UPDATE sources SET config = $1::text::jsonb WHERE id = $2`,
    [JSON.stringify(normalizeSourceConfig(config)), id],
  );
}
