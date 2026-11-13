/**
 * gbrain sources set-gh-exclude <id> <owner/name,...|none>
 *
 * Modeled on test/sources-set-path.test.ts (same runSources dispatch, same
 * process.exit stub).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { runSources } from '../src/commands/sources.ts';
import { parseSourceConfig } from '../src/core/sources-load.ts';

describe('gbrain sources set-gh-exclude', () => {
  let engine: PGLiteEngine;
  let origExit: typeof process.exit;
  let exitCode: number | null;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
  });

  afterAll(async () => {
    await engine.disconnect();
    process.exit = origExit;
  });

  beforeEach(async () => {
    await resetPgliteState(engine);
    exitCode = null;
    origExit = process.exit;
    (process as unknown as { exit: (n: number) => never }).exit = ((n: number) => {
      exitCode = n;
      throw new Error(`__test_exit_${n}__`);
    }) as never;
  });

  async function seed(id: string, config: Record<string, unknown>): Promise<void> {
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config) VALUES ($1, $1, $2::text::jsonb)`,
      [id, JSON.stringify(config)],
    );
  }

  async function readConfig(id: string): Promise<Record<string, unknown>> {
    const rows = await engine.executeRaw<{ config: unknown }>(`SELECT config FROM sources WHERE id = $1`, [id]);
    return parseSourceConfig(rows[0]!.config);
  }

  async function expectExit(args: string[], code: number): Promise<void> {
    await expect(runSources(engine, args)).rejects.toThrow(`__test_exit_${code}__`);
    expect(exitCode).toBe(code);
  }

  test('sets a normalized list and keeps the rest of the config', async () => {
    await seed('gh', { kind: 'github', gh_scope: 'auto', federated: true });
    await runSources(engine, ['set-gh-exclude', 'gh', ' Acme/Zed,acme/secret,acme/secret ']);
    const cfg = await readConfig('gh');
    expect(cfg.gh_exclude).toBe('acme/secret,acme/zed');
    expect(cfg.gh_scope).toBe('auto');
    expect(cfg.federated).toBe(true);
  });

  test('"none" and "" both clear the list', async () => {
    for (const clear of ['none', '']) {
      await resetPgliteState(engine);
      await seed('gh', { kind: 'github', gh_exclude: 'acme/secret' });
      await runSources(engine, ['set-gh-exclude', 'gh', clear]);
      expect('gh_exclude' in (await readConfig('gh'))).toBe(false);
    }
  });

  test('missing args exit 2', async () => {
    await expectExit(['set-gh-exclude', 'gh'], 2);
  });

  test('an invalid name exits 2 without writing', async () => {
    await seed('gh', { kind: 'github' });
    await expectExit(['set-gh-exclude', 'gh', 'acme/secret,secret'], 2);
    expect('gh_exclude' in (await readConfig('gh'))).toBe(false);
  });

  test('a non-github source exits 3', async () => {
    await seed('notes', { federated: true });
    await expectExit(['set-gh-exclude', 'notes', 'acme/secret'], 3);
    expect('gh_exclude' in (await readConfig('notes'))).toBe(false);
  });

  test('an unknown source exits 4', async () => {
    await expectExit(['set-gh-exclude', 'nope', 'acme/secret'], 4);
  });
});
