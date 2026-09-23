/**
 * I1: one function for every change to an idea's state, called by the app (ui.ts, taste/events)
 * AND by Maya's chat tools, so both write the same row and the same taste event (§1 rule 1:
 * everything in the app is possible in chat). The ownership check lives here, once.
 *
 * Awareness (M4): an app action is recorded in `userActions` so she can notice it. A chat action
 * isn't: she did it herself, in the conversation, and she already knows.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { recordAction } from "./act";
import { applyEvent, featureKeys, WEIGHTS, type Affinity } from "../taste/affinities";
import { ensureSeparated } from "../taste/separation";

export const IDEA_ACTS = ["save", "unsave", "pass", "restore", "posted"] as const;
export type IdeaAct = (typeof IDEA_ACTS)[number];
export type Origin = "app" | "chat";

export const hookOf = (idea: Doc<"ideas">): string => (idea.version as { hook?: string } | undefined)?.hook ?? idea.messageText.slice(0, 60);

export async function applyIdeaAct(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  ideaId: Id<"ideas">,
  act: IdeaAct,
  opts: { origin: Origin; postUrl?: string },
): Promise<{ ok: boolean; reason?: string; hook?: string; changed?: boolean }> {
  const idea = (await ctx.db.get(ideaId)) as Doc<"ideas"> | null;
  // Cross-tenant: one guard for both surfaces.
  if (!idea || idea.creatorId !== creatorId) return { ok: false, reason: "not one of their ideas" };
  const hook = hookOf(idea);
  const aware = async (kind: string, verb: string) => {
    if (opts.origin === "app") await recordAction(ctx, { creatorId, kind, objectId: ideaId, summary: `${verb} your idea "${hook}"` });
  };

  if (act === "save") {
    if (idea.savedAt) return { ok: true, hook, changed: false };
    await ctx.db.patch(ideaId, { savedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.taste.events.record, { creatorId, kind: "save", ideaId });
    await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId, kind: "swipe", refId: String(ideaId), text: `${(idea.version as { hook?: string } | undefined)?.hook ?? ""}\n${idea.messageText}` });
    await aware("idea.save", "saved");
    return { ok: true, hook, changed: true };
  }
  if (act === "unsave") {
    if (!idea.savedAt) return { ok: true, hook, changed: false };
    await ctx.db.patch(ideaId, { savedAt: undefined });
    await aware("idea.unsave", "unsaved");
    return { ok: true, hook, changed: true };
  }
  if (act === "pass") {
    if (idea.status === "passed") return { ok: true, hook, changed: false };
    await ctx.db.patch(ideaId, { status: "passed" });
    await ctx.scheduler.runAfter(0, internal.taste.events.record, { creatorId, kind: "notme", ideaId });
    await aware("idea.pass", "passed on");
    return { ok: true, hook, changed: true };
  }
  if (act === "restore") {
    if (idea.status !== "passed" && idea.status !== "expired") return { ok: true, hook, changed: false };
    await ctx.db.patch(ideaId, { status: "sent" });
    await aware("idea.restore", "brought back");
    return { ok: true, hook, changed: true };
  }

  // posted
  if (idea.status === "posted") return { ok: true, hook, changed: false };
  let creator = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!creator) return { ok: false, reason: "no creator" };
  creator = await ensureSeparated(ctx, creator);
  const now = Date.now();
  const keys = featureKeys(idea.features);
  const weight = idea.newForYou ? WEIGHTS.posted * 2 : WEIGHTS.posted;
  await ctx.db.insert("tasteEvents", { creatorId, ideaId, kind: "posted", weight, features: keys, at: now });
  if (keys.length) await ctx.db.patch(creatorId, { affinities: applyEvent((creator.affinities ?? []) as Affinity[], keys, weight, now), updatedAt: now });
  const matched = opts.postUrl ? await matchOwnPost(ctx, creatorId, opts.postUrl) : null;
  await ctx.db.patch(ideaId, { status: "posted", postedAt: now, matchConfidence: "certain", ...(matched ? { matchedPostId: matched } : {}) });
  await aware("idea.posted", "marked as posted");
  return { ok: true, hook, changed: true };
}

/** Their own post by the link they gave, if we have it; never another creator's. */
async function matchOwnPost(ctx: MutationCtx, creatorId: Id<"creators">, url: string): Promise<Id<"ownPosts"> | null> {
  const id = url.match(/\/video\/(\d+)/)?.[1] ?? url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
  if (!id) return null;
  const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(120)) as Doc<"ownPosts">[];
  return rows.find((r) => r.postId === id || r.url.includes(`/${id}`))?._id ?? null;
}
