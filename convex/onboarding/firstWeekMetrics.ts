/**
 * Is the opening working? (2026-11-04) Four numbers, from rows, for real people who paired in a window:
 *
 *   replied      answered her opening within 24 hours
 *   firstReply   how long that took (median, minutes)
 *   brought      sent her a video or a TikTok within 72 hours of pairing (they found what she's for)
 *   day7         wrote anything on days 6 to 8 (only counted once 8 days have passed)
 *
 * A sim can't measure these: its replies are an actor's. Read it on staging and prod:
 *   npx convex run onboarding/firstWeekMetrics:report '{"days":30}'
 * Test personas (eval) are left out. Per-creator rows carry no names, handles or text.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { pairedRows } from "../core/schedule";

const H = 3_600_000, D = 24 * H;

export interface CreatorWeek { pairedAt: number; openingAt: number | null; firstReplyMin: number | null; brought: boolean; day7: boolean | null }

/** Pure: one creator's first week, from their messages (any order). */
export function weekOf(pairedAt: number, msgs: Array<Pick<Doc<"messages">, "direction" | "kind" | "ts" | "deliveredAt" | "body" | "fileMime">>, now: number): CreatorWeek {
  const sorted = [...msgs].sort((a, b) => a.ts - b.ts);
  const opening = sorted.find((m) => m.direction === "out" && (m.kind === "first_read" || m.kind === "hello") && m.ts >= pairedAt - 2 * D);
  const openingAt = opening ? opening.deliveredAt ?? opening.ts : null;
  const theirs = sorted.filter((m) => m.direction === "in" && m.kind !== "pairing" && m.kind !== "reaction");
  const reply = openingAt !== null ? theirs.find((m) => m.ts > openingAt) : undefined;
  const firstReplyMin = reply && openingAt !== null && reply.ts - openingAt <= D ? Math.round((reply.ts - openingAt) / 60_000) : null;
  const brought = theirs.some((m) => m.ts <= pairedAt + 3 * D && ((m.kind === "file" && /^video\//.test(m.fileMime ?? "")) || m.kind === "share" || /tiktok\.com\//i.test(m.body ?? "")));
  const day7 = now - pairedAt < 8 * D ? null : theirs.some((m) => m.ts >= pairedAt + 6 * D && m.ts < pairedAt + 8 * D);
  return { pairedAt, openingAt, firstReplyMin, brought, day7 };
}

/** Pure: the four numbers over many creators. */
export function summarize(weeks: CreatorWeek[]): { creators: number; replied: string; medianFirstReplyMin: number | null; brought: string; day7: string } {
  const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "0/0");
  const opened = weeks.filter((w) => w.openingAt !== null);
  const times = opened.map((w) => w.firstReplyMin).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const eligible7 = weeks.filter((w) => w.day7 !== null);
  return {
    creators: weeks.length,
    replied: pct(times.length, opened.length),
    medianFirstReplyMin: times.length ? times[Math.floor(times.length / 2)] : null,
    brought: pct(weeks.filter((w) => w.brought).length, weeks.length),
    day7: pct(eligible7.filter((w) => w.day7).length, eligible7.length),
  };
}

export const report = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const since = now - (a.days ?? 30) * D;
    // The slim paired index (core/schedule), never the whole creators table; it already leaves test personas out.
    const creators: Doc<"creators">[] = [];
    for (const r of await pairedRows(ctx, { activeOnly: false })) {
      const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
      if (c && (c.channel.pairedAt ?? 0) >= since && !/^eval/.test(c.clerkUserId ?? "")) creators.push(c);
    }
    const weeks: CreatorWeek[] = [];
    for (const c of creators) {
      const pairedAt = c.channel.pairedAt!;
      const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", pairedAt - 2 * D).lte("ts", pairedAt + 9 * D)).take(500)) as Doc<"messages">[];
      weeks.push(weekOf(pairedAt, msgs, now));
    }
    return { summary: summarize(weeks), creators: weeks.map((w) => ({ pairedDaysAgo: Math.floor((now - w.pairedAt) / D), firstReplyMin: w.firstReplyMin, brought: w.brought, day7: w.day7 })) };
  },
});
