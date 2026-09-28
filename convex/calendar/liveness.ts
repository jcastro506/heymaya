/**
 * When a booked block stops meaning anything (product sim, 2026-09-28). One definition, read by
 * everything that talks about the plan: the morning line, the reminders, "how'd it go", her context,
 * the week_plan tool and the app.
 *
 * The sim found her saying "filming today: <the video they posted yesterday>" and "posting at 11 am:
 * <a video that was never filmed>", several times in one week. Nothing retired an idea's other blocks
 * when it was filmed, posted or missed. A block is moot when:
 *   - its idea is posted: every film and edit block, and any post block after the post;
 *   - it films an idea that another block already filmed (before it);
 *   - it edits or posts an idea whose every film block before it was missed or dropped, and none filmed.
 *
 * A missed film block that was put back (moved later) is live again: "missed" means missed at its
 * CURRENT time (`missedAt >= start`), because "put it back" moves the same block.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export type BlockLike = Pick<Doc<"calendarBlocks">, "_id" | "kind" | "start" | "end" | "status" | "ideaId" | "filmedAt" | "missedAt">;
export type IdeaLike = { status?: string; postedAt?: number } | null;

/** Pure: missed at its current time (a block put back later is pending again). */
export function missedNow(b: Pick<BlockLike, "start" | "missedAt">): boolean {
  return b.missedAt !== undefined && b.missedAt >= b.start;
}

/** Pure: why this block no longer means anything, or null. `sameIdea` is every block for its idea (it may include `b`). */
export function mootReason(b: BlockLike, sameIdea: BlockLike[], idea: IdeaLike): string | null {
  if (b.status === "deleted" || !b.ideaId) return null;
  if (idea?.status === "posted") {
    if (b.kind !== "post") return "already posted";
    if (idea.postedAt === undefined || idea.postedAt <= b.start) return "already posted";
  }
  const films = sameIdea.filter((x) => x.kind === "film" && x._id !== b._id);
  if (b.kind === "film") {
    return films.some((f) => f.status !== "deleted" && f.filmedAt !== undefined && f.filmedAt <= b.start) ? "already filmed" : null;
  }
  // Edit or post: needs a film for this idea that happened, or that can still happen before it.
  const allFilms = sameIdea.filter((x) => x.kind === "film");
  if (!allFilms.length) return null; // their own footage (no film block ever): leave it
  const covered = allFilms.some((f) => f.status !== "deleted" && (f.filmedAt !== undefined || (!missedNow(f) && f.start <= b.start)));
  return covered ? null : "nothing filmed for it yet";
}

type Reader = Pick<QueryCtx, "db">;

/** The ideas and sibling blocks `mootReason` needs for these blocks. */
async function siblingsFor(ctx: Reader, blocks: BlockLike[], creatorId: Id<"creators">): Promise<{ byIdea: Map<string, BlockLike[]>; ideas: Map<string, IdeaLike> }> {
  const ideaIds = Array.from(new Set(blocks.map((b) => b.ideaId).filter((x): x is Id<"ideas"> => Boolean(x))));
  const byIdea = new Map<string, BlockLike[]>();
  const ideas = new Map<string, IdeaLike>();
  if (!ideaIds.length) return { byIdea, ideas };
  const from = Math.min(...blocks.map((b) => b.start)) - 21 * 86_400_000;
  const to = Math.max(...blocks.map((b) => b.start)) + 21 * 86_400_000;
  const rows = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("start", from).lte("start", to)).take(500)) as Doc<"calendarBlocks">[];
  for (const r of rows) if (r.ideaId && ideaIds.includes(r.ideaId)) byIdea.set(r.ideaId, [...(byIdea.get(r.ideaId) ?? []), r]);
  for (const id of ideaIds) {
    const idea = (await ctx.db.get(id)) as Doc<"ideas"> | null;
    ideas.set(id, idea && idea.creatorId === creatorId ? { status: idea.status, postedAt: idea.postedAt } : null);
  }
  return { byIdea, ideas };
}

/** The blocks that still mean something (deleted ones dropped too). Order kept. */
export async function liveBlocks<T extends BlockLike>(ctx: Reader, creatorId: Id<"creators">, blocks: T[]): Promise<T[]> {
  const kept = blocks.filter((b) => b.status !== "deleted");
  const { byIdea, ideas } = await siblingsFor(ctx, kept, creatorId);
  return kept.filter((b) => !b.ideaId || !mootReason(b, byIdea.get(b.ideaId) ?? [b], ideas.get(b.ideaId) ?? null));
}

/** One block: why it is moot, or null. */
export async function mootReasonFor(ctx: Reader, block: BlockLike & { creatorId: Id<"creators"> }): Promise<string | null> {
  if (!block.ideaId) return null;
  const { byIdea, ideas } = await siblingsFor(ctx, [block], block.creatorId);
  return mootReason(block, byIdea.get(block.ideaId) ?? [block], ideas.get(block.ideaId) ?? null);
}

/**
 * Write time: after an idea is filmed, posted or dropped, retire its blocks that no longer mean anything,
 * so the app and their Google Calendar stop showing them. A block on Google goes through `remove` (which
 * deletes the event); the rest are marked deleted here. A missed film is NOT a reason on its own: "put it
 * back" moves that block, so its edit and post wait (the read side already keeps them quiet).
 */
export async function retireMootFor(ctx: MutationCtx, creatorId: Id<"creators">, ideaId: Id<"ideas">): Promise<number> {
  const now = Date.now();
  const rows = ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("start", now - 21 * 86_400_000).lte("start", now + 60 * 86_400_000)).take(500)) as Doc<"calendarBlocks">[]).filter((b) => b.ideaId === ideaId);
  const idea = (await ctx.db.get(ideaId)) as Doc<"ideas"> | null;
  const info: IdeaLike = idea && idea.creatorId === creatorId ? { status: idea.status, postedAt: idea.postedAt } : null;
  let retired = 0;
  for (const b of rows) {
    // The past is history, not clutter. A shoot that has started, or that they said they filmed, is never
    // taken off their calendar because they posted (product sim 2026-09-28: a filmed block was deleted after the post).
    if (b.status === "deleted" || b.end < now || b.start <= now || b.filmedAt !== undefined) continue;
    const why = mootReason(b, rows, info);
    // "nothing filmed" is only final when no film for the idea is left at all (dropped, not merely missed).
    if (!why || (why === "nothing filmed for it yet" && rows.some((f) => f.kind === "film" && f.status !== "deleted"))) continue;
    if (b.externalEventId) await ctx.scheduler.runAfter(0, internal.calendar.blocks.remove, { blockId: b._id });
    else await ctx.db.patch(b._id, { status: "deleted", rev: (b.rev ?? 0) + 1 });
    retired += 1;
  }
  return retired;
}
