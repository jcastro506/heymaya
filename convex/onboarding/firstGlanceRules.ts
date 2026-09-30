/**
 * The first glance (2026-09-29): about a minute after they text START, one line from their numbers
 * alone, so the minutes before her full read aren't silent. Code writes it from rows, never a model:
 * it can't guess a cause, and it says nothing when nothing stands out. Pure.
 */
export const FIRST_GLANCE = {
  afterMs: 60_000,
  retryMs: 60_000,
  maxAttempts: 5,
  /** A multiple means something only on a real normal. */
  minPostsWithMultiple: 5,
  minMultiple: 1.5,
  maxMultiple: 50,
  recentDays: 90,
} as const;

export type GlancePost = { caption: string; multiple: number | null; createTime: number };

/** A caption as a short title: first line, no hashtags or mentions, cut on a word. */
export function titleOf(caption: string, max = 48): string | null {
  const line = caption.split("\n")[0].replace(/[#@][\w.]+/g, "").replace(/\s+/g, " ").trim();
  if (line.length < 4) return null;
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim()}…`;
}

export function glanceLine(posts: GlancePost[], now: number): string | null {
  const withMultiple = posts.filter((p) => typeof p.multiple === "number");
  if (withMultiple.length < FIRST_GLANCE.minPostsWithMultiple) return null;
  const since = now - FIRST_GLANCE.recentDays * 86_400_000;
  const best = withMultiple
    .filter((p) => p.createTime * (p.createTime < 1e12 ? 1000 : 1) >= since && p.multiple! >= FIRST_GLANCE.minMultiple && p.multiple! <= FIRST_GLANCE.maxMultiple)
    .sort((a, b) => b.multiple! - a.multiple!)[0];
  if (!best) return null;
  const title = titleOf(best.caption);
  const x = best.multiple! >= 10 ? Math.round(best.multiple!) : Math.round(best.multiple! * 10) / 10;
  return `first look: your best one lately is ${title ? `"${title}"` : "a recent post"}, at ${x}x your normal. still watching the rest, more soon.`;
}
