/**
 * How far her first read of their posts has got: one definition for the Today card and for every
 * path that answers them (2026-10-01). Until her first-read text exists, the read is still running.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type Reading = { stage: "waiting" | "reading" | "read"; posts: number; watched: number; toWatch: number; lastWatched: string | null; summary: string | null; topFormat: string | null; readAt: number | null };

/** One definition of "how far is her read": the Today card and her replies both read this. */
export async function readingOf(ctx: QueryCtx, c: Doc<"creators">): Promise<Reading> {
  const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(400)) as Doc<"ownPosts">[];
  const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).take(200)) as Doc<"ownPostReads">[];
  const watchedReads = reads.filter((r) => r.depth === "watch");
  const last = watchedReads.sort((x, y) => y._creationTime - x._creationTime)[0];
  const lastPost = last ? posts.find((p) => p._id === last.ownPostId) : undefined;
  const d = c.dossier as { persona?: { summary?: string }; formatsUsed?: Array<{ label: string; count: number }>; rewrittenAt?: string } | undefined;
  const top = [...(d?.formatsUsed ?? [])].sort((x, y) => y.count - x.count)[0];
  const toWatch = posts.filter((p) => (p.sample ?? []).length > 0 && p.contentType === "video").length;
  return {
    stage: d ? "read" : posts.length ? "reading" : "waiting",
    posts: posts.length,
    watched: watchedReads.length,
    toWatch: Math.max(toWatch, watchedReads.length),
    lastWatched: lastPost ? lastPost.caption.split("\n")[0].slice(0, 80) : null,
    summary: d?.persona?.summary ?? null,
    topFormat: top?.label ?? null,
    readAt: d?.rewrittenAt ? Date.parse(d.rewrittenAt) : null,
  };
}

/** Null once her first-read text exists; otherwise how far she's got. */
export async function stillReading(ctx: QueryCtx, c: Doc<"creators">): Promise<{ posts: number; watched: number; toWatch: number } | null> {
  const sent = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", c._id).eq("dedupeKey", `first_read:${c._id}`)).first();
  if (sent) return null;
  // Only while the read is actually under way (day sim, 2026-10-01: an account read long ago, with no
  // first-read text on record, got "still finishing your posts" on every reply and "plan my week" deferred).
  const jobs = (await ctx.db.query("jobs").withIndex("by_creator_and_createdAt", (q) => q.eq("creatorId", c._id)).order("desc").take(30)) as Doc<"jobs">[];
  const underWay = jobs.some((j) => (j.kind === "ingest_catalogue" || j.kind === "first_read") && (j.status === "queued" || j.status === "running"));
  if (!underWay) return null;
  const r = await readingOf(ctx, c);
  return { posts: r.posts, watched: r.watched, toWatch: r.toWatch };
}

/** The line every reply path carries while the read runs (agent/context gather). Pure. */
export function stillReadingSection(s: { posts: number; watched: number; toWatch: number }): string {
  return `# Right now\nYou are still going through their posts (${s.watched} of ${s.toWatch || s.posts} watched so far). Your read will come as its own text when it's done. Until then, do not summarize, rank or judge their posts or name what's working, and do not ask which of their topics to lean into: answer what they said, and if it needs your read, say you'll come back to that in a few minutes. Questions about what they want are welcome.`;
}
