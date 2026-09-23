/**
 * S0: one action per creator, never a loop of them inside one action. An action stops at 10
 * minutes and a scout pass with model calls takes 20–60 s, so a sequential loop silently dropped
 * everyone after the first ~15 due creators in an hour. Spread across a window so vendor calls
 * don't all land in the same second. Pure; tested.
 */
export function spreadDelays(n: number, windowMs: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const step = windowMs / n;
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

/** Within the hour a job fired in, leaving room for the next firing: 40 minutes. */
export const HOURLY_SPREAD_MS = 40 * 60_000;
