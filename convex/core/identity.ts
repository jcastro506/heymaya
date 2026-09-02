import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The creator behind the Clerk session, or null. Every public read and write scopes through this. */
export async function creatorForIdentity(ctx: QueryCtx | MutationCtx): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
}
