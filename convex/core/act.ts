/**
 * What the creator did in the app, so Maya knows (app spec §7.2–7.3, decision D3). Every app
 * write records one `userActions` row. Awareness per kind:
 * - state: nothing extra; she reads the rows when she looks.
 * - noticed: shown once in her context ("Since you last spoke, in the app"), then marked seen.
 * - reacted: noticed, and may prompt a message within the rails (v1: share, Ask Maya, upgrade).
 * She mentions a noticed action only when it changes her answer; she never claims or apologises
 * for a change the creator made, and never texts just because of a tap.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Awareness = "state" | "noticed" | "reacted";
export const AWARENESS: Record<string, Awareness> = {
  "idea.save": "state",
  "idea.unsave": "state",
  "idea.pass": "noticed",
  "idea.posted": "noticed",
  "rule.revoke": "noticed",
  "correction.add": "noticed",
  "settings.update": "state",
  "block.confirm": "noticed",
  "block.move": "noticed",
  "block.drop": "noticed",
  "account.add": "noticed",
  "account.remove": "noticed",
  "ask": "reacted",
  "share": "reacted",
  "plan.upgraded": "reacted",
};

export async function recordAction(ctx: MutationCtx, a: { creatorId: Id<"creators">; kind: string; source?: Doc<"userActions">["source"]; objectId?: string; summary: string }): Promise<void> {
  await ctx.db.insert("userActions", { creatorId: a.creatorId, kind: a.kind, source: a.source ?? "app", objectId: a.objectId, summary: a.summary.slice(0, 200), at: Date.now() });
}

const WINDOW_MS = 14 * 86_400_000;

/** Unseen noticed/reacted actions, newest last, for her context. Scoped to the creator. */
export async function unseenActions(ctx: QueryCtx, creatorId: Id<"creators">, now: number): Promise<Doc<"userActions">[]> {
  const rows = (await ctx.db.query("userActions").withIndex("by_creator_at", (q) => q.eq("creatorId", creatorId).gte("at", now - WINDOW_MS)).order("desc").take(40)) as Doc<"userActions">[];
  return rows.filter((r) => !r.seenByAgentAt && (AWARENESS[r.kind] ?? "state") !== "state").reverse();
}

/** The context section. Collapses repeats of one kind ("passed 4 ideas: …"). Pure. */
export function appActionsSection(rows: Array<Pick<Doc<"userActions">, "kind" | "summary" | "at" | "source">>, now: number): string {
  if (!rows.length) return "";
  const byKind = new Map<string, typeof rows>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const ago = (t: number) => { const h = Math.round((now - t) / 3_600_000); return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };
  const lines = [...byKind.values()].map((group) => group.length === 1
    ? `- ${group[0].summary} (${ago(group[0].at)}, in the ${group[0].source === "app" ? "app" : group[0].source})`
    : `- ${group.length}× ${group[0].kind.replace(".", " ")}: ${group.slice(-4).map((g) => g.summary).join("; ")} (latest ${ago(group[group.length - 1].at)})`);
  return `# Since you last spoke, in the app (they did these themselves; mention one only if it changes your answer; never claim or apologise for their change)\n${lines.join("\n")}`;
}

/** Mark everything up to `upTo` seen. Called by the one message writer when SHE speaks. */
export async function markActionsSeen(ctx: MutationCtx, creatorId: Id<"creators">, upTo: number): Promise<number> {
  const rows = (await ctx.db.query("userActions").withIndex("by_creator_at", (q) => q.eq("creatorId", creatorId).lte("at", upTo)).order("desc").take(100)) as Doc<"userActions">[];
  let n = 0;
  for (const r of rows) if (!r.seenByAgentAt) { await ctx.db.patch(r._id, { seenByAgentAt: upTo }); n++; }
  return n;
}

/** After she has had a turn with them in context. */
export const markSeen = internalMutation({
  args: { creatorId: v.id("creators"), upTo: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const rows = (await ctx.db.query("userActions").withIndex("by_creator_at", (q) => q.eq("creatorId", a.creatorId).lte("at", a.upTo)).order("desc").take(100)) as Doc<"userActions">[];
    let n = 0;
    for (const r of rows) if (!r.seenByAgentAt) { await ctx.db.patch(r._id, { seenByAgentAt: a.upTo }); n++; }
    return n;
  },
});
