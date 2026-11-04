/**
 * The calendar moments a post can sit on (2026-11-04). A tester's best post was a Halloween costume: 24× her
 * usual, and her read built a direction on it. An expert reads that as a moment (plan for next Halloween),
 * not a lane. Code says which posts sit near a holiday, as a fact; she judges what it means. Pure.
 */

export interface Moment { name: string; date: string }

/** The nth weekday (0 = Sunday) of a month, as a UTC date. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

/** The year's moments people post around (US-leaning; the date is when the moment is). */
export function momentsOf(year: number): Array<{ name: string; at: Date }> {
  const d = (m: number, day: number) => new Date(Date.UTC(year, m, day));
  return [
    { name: "New Year's", at: d(0, 1) },
    { name: "Valentine's Day", at: d(1, 14) },
    { name: "St. Patrick's Day", at: d(2, 17) },
    { name: "Mother's Day", at: nthWeekday(year, 4, 0, 2) },
    { name: "Father's Day", at: nthWeekday(year, 5, 0, 3) },
    { name: "the Fourth of July", at: d(6, 4) },
    { name: "Halloween", at: d(9, 31) },
    { name: "Thanksgiving", at: nthWeekday(year, 10, 4, 4) },
    { name: "Christmas", at: d(11, 25) },
    { name: "New Year's Eve", at: d(11, 31) },
  ];
}

const DAY = 86_400_000;

/** Pure: the moment a post sits on (posted up to 10 days before it or 2 days after), or null. */
export function momentFor(ts: number): Moment | null {
  const year = new Date(ts).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    for (const m of momentsOf(y)) {
      const delta = ts - m.at.getTime();
      if (delta >= -10 * DAY && delta <= 3 * DAY) return { name: m.name, date: m.at.toISOString().slice(0, 10) };
    }
  }
  return null;
}

/** Pure: when a moment comes round next, after `now` (for "plan for next Halloween"). */
export function nextOf(name: string, now: number): string | null {
  const year = new Date(now).getUTCFullYear();
  for (const y of [year, year + 1]) {
    const hit = momentsOf(y).find((m) => m.name === name && m.at.getTime() > now);
    if (hit) return hit.at.toISOString().slice(0, 10);
  }
  return null;
}
