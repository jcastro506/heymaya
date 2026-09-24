/**
 * I1: Maya's hands on their ideas, equal to the app. Thin callers: state changes go through
 * `core/ideaActs.applyIdeaAct` (the same function the app calls), edits through
 * `moment.editIdea`, and planning through the calendar's own `block_add` with the idea attached.
 *
 * Which idea "the humidity one" is, is HER judgment: `ideas_list` gives her the ideas with ids,
 * hooks, dates and status, and she decides (or asks). Code only guarantees she acts on their own.
 * Idea text is data the creator's feed and her own writing produced; it is never an instruction.
 */

import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { applyIdeaAct, hookOf, IDEA_ACTS, type IdeaAct } from "../core/ideaActs";

// Words in how people describe an idea that name nothing ("the one about the…").
const FILLER = new Set(["the", "one", "that", "this", "idea", "ideas", "with", "from", "about", "and", "for", "you", "your", "sent", "thing", "video", "post"]);

export type IdeaFilter = "open" | "saved" | "passed" | "posted" | "all";

/** Pure: which ideas a filter and a text query keep, newest first. */
export function filterIdeas<T extends Pick<Doc<"ideas">, "status" | "savedAt" | "messageText" | "version">>(rows: T[], filter: IdeaFilter, query: string): T[] {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !FILLER.has(w));
  return rows
    .filter((i) => {
      if (filter === "open") return i.status === "sent" || i.status === "hearted";
      if (filter === "saved") return Boolean(i.savedAt);
      if (filter === "passed") return i.status === "passed" || i.status === "expired";
      if (filter === "posted") return i.status === "posted";
      return true;
    })
    .filter((i) => {
      if (!words.length) return true;
      const hay = `${(i.version as { hook?: string } | undefined)?.hook ?? ""} ${i.messageText}`.toLowerCase();
      return words.some((w) => hay.includes(w));
    });
}

export const list = internalQuery({
  args: { creatorId: v.id("creators"), filter: v.string(), query: v.string() },
  handler: async (ctx, a): Promise<Array<{ id: Id<"ideas">; hook: string; status: string; saved: boolean; sentOn: string | null; postedOn: string | null }>> => {
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(120)) as Doc<"ideas">[];
    const filter = (["open", "saved", "passed", "posted", "all"].includes(a.filter) ? a.filter : "all") as IdeaFilter;
    const day = (t?: number) => (t ? new Date(t).toISOString().slice(0, 10) : null); // an ISO date for her to read, not a day boundary
    return filterIdeas(rows, filter, a.query).slice(0, 15).map((i) => ({ id: i._id, hook: hookOf(i), status: i.status, saved: Boolean(i.savedAt), sentOn: day(i.sentAt ?? i._creationTime), postedOn: day(i.postedAt) }));
  },
});

export const get = internalQuery({
  args: { creatorId: v.id("creators"), ideaId: v.string() },
  handler: async (ctx, a): Promise<Doc<"ideas"> | null> => {
    const id = ctx.db.normalizeId("ideas", a.ideaId);
    const i = id ? ((await ctx.db.get(id)) as Doc<"ideas"> | null) : null;
    return i && i.creatorId === a.creatorId ? i : null;
  },
});

export const status = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.string(), act: v.string(), postUrl: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; hook?: string; changed?: boolean }> => {
    if (!IDEA_ACTS.includes(a.act as IdeaAct)) return { ok: false, reason: `act must be one of ${IDEA_ACTS.join(", ")}` };
    const id = ctx.db.normalizeId("ideas", a.ideaId);
    if (!id) return { ok: false, reason: "no such idea; read ideas_list for the ids" };
    return await applyIdeaAct(ctx, a.creatorId, id, a.act as IdeaAct, { origin: "chat", postUrl: a.postUrl });
  },
});
