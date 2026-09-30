/**
 * Fork: GBRAIN_MANAGED_INSTALL_HINT makes both install-replacing commands
 * refuse before doing anything. See FORK.md, "Managed-install hint".
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const HINT = 'Managed by the host config: bump the pinned revision.';

function runCli(args: string[], hint: string | undefined) {
  const home = mkdtempSync(join(tmpdir(), 'gbrain-managed-'));
  const env: Record<string, string> = { ...process.env, HOME: home, GBRAIN_HOME: join(home, '.gbrain') } as Record<string, string>;
  delete env.GBRAIN_MANAGED_INSTALL_HINT;
  if (hint !== undefined) env.GBRAIN_MANAGED_INSTALL_HINT = hint;
  const r = Bun.spawnSync(['bun', 'run', `${REPO}/src/cli.ts`, ...args], { cwd: home, env, timeout: 60_000 });
  return { code: r.exitCode, stderr: r.stderr.toString() };
}

describe('managed-install refusal', () => {
  for (const command of ['self-upgrade', 'upgrade']) {
    test(`${command} refuses with the hint and exits 1`, () => {
      const r = runCli([command], HINT);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain(`gbrain ${command}: this install is managed externally.`);
      expect(r.stderr).toContain(HINT);
    });
  }

  test('a blank hint does not refuse', () => {
    const r = runCli(['self-upgrade', '--help'], '   ');
    expect(r.stderr).not.toContain('managed externally');
  });
});
