/** Wall-clock ↔ epoch in a creator's timezone, with Intl only (no tz library in the isolate). */

function partsInZone(epoch: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(epoch).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

/** "YYYY-MM-DDTHH:MM" as read on the creator's clock → epoch ms. NaN if unparsable. */
export function zonedTimeToEpoch(local: string, timeZone: string): number {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return NaN;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes handle a DST edge on the day itself.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, timeZone);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += asUtc - seen;
  }
  return guess;
}

/** "Tue Sep 9, 3:00 PM" on the creator's clock. */
export function formatLocal(epoch: number, timeZone: string, opts: { withTime?: boolean } = { withTime: true }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", ...(opts.withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(epoch);
}

/** "YYYY-MM-DD" on the creator's clock. */
export function localDateKey(epoch: number, timeZone: string): string {
  const p = partsInZone(epoch, timeZone);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
