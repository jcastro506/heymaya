import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { applyEvent, type Affinity } from "./affinities";

export const isOutcome = (kind: string) => kind === "outcome_win" || kind === "outcome_flop";

/** Replay the event ledger, not subtraction from rounded/decayed mixed scores. */
export function splitEvents(events: Pick<Doc<"tasteEvents">, "kind" | "features" | "weight" | "at">[]) {
  let preferences: Affinity[] = [];
  let performance: Affinity[] = [];
  for (const event of [...events].sort((a, b) => a.at - b.at)) {
    if (isOutcome(event.kind)) performance = applyEvent(performance, event.features, event.weight, event.at);
    else preferences = applyEvent(preferences, event.features, event.weight, event.at);
  }
  return { preferences, performance };
}

export async function separatedCreator(ctx: QueryCtx, creator: Doc<"creators">): Promise<Doc<"creators">> {
  if (creator.signalsSeparatedAt) return creator;
  const events = await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect();
  const signals = splitEvents(events);
  return { ...creator, affinities: events.length ? signals.preferences : creator.affinities, performanceAffinities: signals.performance, taste: events.some((e) => isOutcome(e.kind)) ? undefined : creator.taste };
}

export async function ensureSeparated(ctx: MutationCtx, creator: Doc<"creators">): Promise<Doc<"creators">> {
  if (creator.signalsSeparatedAt) return creator;
  const clean = await separatedCreator(ctx, creator);
  const patch = { affinities: clean.affinities, performanceAffinities: clean.performanceAffinities ?? [], taste: clean.taste, signalsSeparatedAt: Date.now() };
  await ctx.db.patch(creator._id, patch);
  return { ...clean, ...patch };
}
