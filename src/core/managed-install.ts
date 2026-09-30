/**
 * Refuse commands that replace the install when an external manager owns it
 * (GBRAIN_MANAGED_INSTALL_HINT set). A fork addition: see FORK.md,
 * "Managed-install hint".
 *
 * The version notice stops an upgrade being SUGGESTED; only this stops someone
 * who runs one from memory, from an older shell history, from a doctor or skill
 * hint.
 *
 * The escape hatch is unsetting the variable, NOT a flag. `--force` already
 * means "apply even if not behind" in self-upgrade, so reusing it would give one
 * flag two unrelated meanings and quietly disarm this guard for anyone who
 * reached for --force because the command looked stuck. A new flag is no
 * better: the pre-dispatch validator rejects flags absent from
 * cli-flag-registry.generated.ts, so it would mean editing generated code and
 * carrying that on every rebase.
 */

import { setCliExitVerdict } from './cli-force-exit.ts';

/**
 * The hint when an external manager owns the install, else null. Also read by
 * the two paths that start an upgrade without a person typing the command:
 * autopilot's auto mode treats it as an install it cannot update, and the
 * thin-client prompt stays silent (the version notice already prints the hint).
 */
export function managedInstallHint(): string | null {
  return process.env.GBRAIN_MANAGED_INSTALL_HINT?.trim() || null;
}

/** True when the command was refused; the caller must return without running it. */
export function refuseManagedInstall(command: string): boolean {
  const hint = managedInstallHint();
  if (!hint) return false;
  process.stderr.write(
    `gbrain ${command}: this install is managed externally.\n${hint}\n` +
    `To override, run with GBRAIN_MANAGED_INSTALL_HINT unset.\n`,
  );
  setCliExitVerdict(1);
  return true;
}
