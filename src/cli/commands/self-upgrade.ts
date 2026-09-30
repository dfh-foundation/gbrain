/**
 * `gbrain self-upgrade`: pre-connect dispatch (engine-free), run by
 * handleCliOnly before the connectEngine() terminator. Moved verbatim from
 * src/cli.ts (refactor wave 1, W4 cli); the record lives in src/cli/command-table.ts.
 */

import { refuseManagedInstall } from '../../core/managed-install.ts';

export async function run(args: string[]): Promise<void> {
  if (refuseManagedInstall('self-upgrade')) return;
  const { runSelfUpgrade } = await import('../../commands/self-upgrade.ts');
  await runSelfUpgrade(args);
}
