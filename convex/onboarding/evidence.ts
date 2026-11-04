/**
 * What she reads their posts from (2026-11-04). The dossier used to be written from views and a multiple
 * alone, over the ten newest posts: a tester's read called her a food creator off two captions and a
 * Halloween month, and missed the one format that never missed (a rating series, every post above her usual,
 * her most-saved post by far). An expert reads saves and shares before views, formats apart from topics, the
 * whole history before the last few weeks, and holidays as moments. Code lays out the facts; she judges. Pure.
 */
import type { Doc } from "../_generated/dataModel";
import { momentFor, nextOf } from "./moments";

type Row = Pick<Doc<"ownPosts">, "postId" | "platform" | "createTime" | "contentType" | "durationSec" | "caption" | "metrics" | "multiple" | "transcript" | "sample" | "connected">;

const per1k = (n: number | null | undefined, views: number): number | null => (n === null || n === undefined || views <= 0 ? null : Math.round((n / views) * 10_000) / 10);
const median = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

export interface PostEvidence {
  id: string; platform: string; when: string; type: string; sec: number | null;
  views: number; multiple: number | null;
  likes: number; comments: number; shares: number; saves: number | null; reach: number | null;
  savesPer1k: number | null; sharesPer1k: number | null; commentsPer1k: number | null;
  /** A holiday it sat on, and when that comes round next. */
  moment: string | null;
  caption: string; transcript: string | null; sample: string[] | null;
}

export interface Usual { posts: number; from: string | null; to: string | null; medianViews: number | null; savesPer1k: number | null; sharesPer1k: number | null; commentsPer1k: number | null }

/** Pure: every post with the numbers an expert weighs, and their usual to read them against. Newest first. */
export function evidenceOf(rows: Row[], now: number, clip: (s: string, n: number) => string): { posts: PostEvidence[]; usual: Usual } {
  const sorted = [...rows].sort((a, b) => b.createTime - a.createTime);
  const posts = sorted.map((r): PostEvidence => {
    const views = r.metrics.views;
    const saves = r.metrics.saves ?? r.connected?.saves ?? null;
    const m = momentFor(r.createTime);
    return {
      id: r.postId, platform: r.platform, when: new Date(r.createTime).toISOString().slice(0, 10), type: r.contentType, sec: r.durationSec ?? null,
      views, multiple: r.multiple ?? null,
      likes: r.metrics.likes, comments: r.metrics.comments, shares: r.metrics.shares, saves, reach: r.connected?.reach ?? null,
      savesPer1k: per1k(saves, views), sharesPer1k: per1k(r.metrics.shares, views), commentsPer1k: per1k(r.metrics.comments, views),
      moment: m ? `${m.name} ${m.date.slice(0, 4)} (next: ${nextOf(m.name, now) ?? "unknown"})` : null,
      caption: clip(r.caption, 200), transcript: r.transcript ? clip(r.transcript, 600) : null, sample: r.sample ?? null,
    };
  });
  const usual: Usual = {
    posts: posts.length,
    from: posts.at(-1)?.when ?? null,
    to: posts[0]?.when ?? null,
    medianViews: median(posts.map((p) => p.views)),
    savesPer1k: median(posts.map((p) => p.savesPer1k ?? NaN)),
    sharesPer1k: median(posts.map((p) => p.sharesPer1k ?? NaN)),
    commentsPer1k: median(posts.map((p) => p.commentsPer1k ?? NaN)),
  };
  return { posts, usual };
}

/** How an expert reads the table: added to learn-creator, and the same lens everywhere she plans from it. */
export const EXPERT_READ = `How to read their numbers (a social media expert's eye):
- Read the whole history you were given, not the last few weeks. Recent posts are one season of their life; a month of fall outfits or one trip is not who they are.
- Saves and shares say more than views: a save means "I want this again", a share means "you need to see this". A post well above their usual saves or shares per 1K views is working even when its views are ordinary; views alone can be one lucky push.
- Separate the FORMAT from the TOPIC. A format is the repeatable structure (rating something out of 10 with a running joke, a series with a name, a reaction, a GRWM, a before/after, a POV). The topic is what it's about (food, outfits, a city). A format that beats their usual across several posts is a "skill" works claim and can carry topics they'd rather make; say the format in its own words and which posts show it. Never reduce a person to the topic of their best format.
- Consistency beats a peak: a format whose every post lands above their usual is a stronger plan than one viral post.
- A post with a "moment" sits on a holiday; a concert, game, trip or launch is a one-off too. Those go in oneOffs as circumstance, with what travels and when the next chance is (the "next" date given), never as a direction.
- Cite post ids for every claim, as always, and say the evidence plainly (e.g. "every rating post beat her usual; the café one was her most saved").`;
