/**
 * `gbrain self-upgrade`: pre-connect dispatch (engine-free), run by
 * handleCliOnly before the connectEngine() terminator. Moved verbatim from
 * src/cli.ts (refactor wave 1, W4 cli); the record lives in src/cli/command-table.ts.
 */

import { setCliExitVerdict } from '../../core/cli-force-exit.ts';

export async function run(args: string[]): Promise<void> {
  // Refuse on an externally managed install. The notice in checkForUpdates
  // stops this being SUGGESTED; only this stops someone who runs it from
  // memory, from an older shell history, or from a doc written before the
  // install was managed — which is the likelier route, since the person who
  // reads the notice is the one already paying attention.
  //
  // The escape hatch is unsetting the variable, NOT a flag. `--force` already
  // means "apply even if not behind" here, so reusing it would give one flag
  // two unrelated meanings and quietly disarm this guard for anyone who reached
  // for --force because the command looked stuck. A new flag is no better: the
  // pre-dispatch validator rejects flags absent from
  // cli-flag-registry.generated.ts, so it would mean editing generated code and
  // carrying that on every rebase.
  const managedHint = process.env.GBRAIN_MANAGED_INSTALL_HINT?.trim();
  if (managedHint) {
    process.stderr.write(
      `gbrain self-upgrade: this install is managed externally.\n${managedHint}\n` +
      `To override, run with GBRAIN_MANAGED_INSTALL_HINT unset.\n`,
    );
    setCliExitVerdict(1);
    return;
  }
  const { runSelfUpgrade } = await import('../../commands/self-upgrade.ts');
  await runSelfUpgrade(args);
}
