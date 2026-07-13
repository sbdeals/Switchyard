/**
 * Crash-loop detection — a pure, dependency-free state machine so it can be
 * unit-tested without Docker or a store. The collector feeds one health
 * observation per service per tick; `observe()` decides when to fire an alert.
 *
 * Signal: a service that Dokploy believes should be running but whose container
 * is missing / restarting / dead (or whose Docker RestartCount keeps climbing)
 * for `threshold` consecutive observations is crash-looping. A cooldown stops
 * the same sustained loop from paging on every tick; a recovery re-arms it so a
 * fresh loop pages immediately.
 */

export interface CrashLoopConfig {
  /** Consecutive unhealthy observations required before firing. */
  threshold: number;
  /** Minimum ms between repeat alerts while a loop stays unhealthy. */
  cooldownMs: number;
}

export const DEFAULT_CRASH_LOOP: CrashLoopConfig = {
  threshold: 3,
  cooldownMs: 15 * 60_000,
};

export interface CrashLoopState {
  /** Run of consecutive unhealthy observations. */
  consecutive: number;
  /** Last Docker RestartCount seen, to detect increments across ticks. */
  lastRestartCount: number | null;
  /** When we last fired, for cooldown accounting (null = re-armed). */
  alertedAt: number | null;
}

export interface HealthObservation {
  /**
   * The service is expected to be up but is not healthy right now: no running
   * container while Dokploy expects one, a restarting/dead/exited task, or a
   * Dokploy `error` status.
   */
  unhealthy: boolean;
  /** Docker RestartCount if known; a jump is treated as an extra crash signal. */
  restartCount?: number | null;
}

export function newCrashLoopState(): CrashLoopState {
  return { consecutive: 0, lastRestartCount: null, alertedAt: null };
}

/**
 * Fold one observation into the state. Returns true exactly on the tick an
 * alert should be sent. Mutates `state` in place (the collector keeps one per
 * appName).
 */
export function observe(
  state: CrashLoopState,
  obs: HealthObservation,
  cfg: CrashLoopConfig,
  now: number,
): boolean {
  // A climbing RestartCount is a crash signal even if the point-in-time probe
  // caught the container briefly "running".
  let unhealthy = obs.unhealthy;
  if (typeof obs.restartCount === "number") {
    if (state.lastRestartCount !== null && obs.restartCount > state.lastRestartCount) {
      unhealthy = true;
    }
    state.lastRestartCount = obs.restartCount;
  }

  if (!unhealthy) {
    // Recovered — reset the run and re-arm so the next loop pages at once.
    state.consecutive = 0;
    state.alertedAt = null;
    return false;
  }

  state.consecutive += 1;
  if (state.consecutive < cfg.threshold) return false;

  if (state.alertedAt !== null && now - state.alertedAt < cfg.cooldownMs) return false;

  state.alertedAt = now;
  return true;
}
