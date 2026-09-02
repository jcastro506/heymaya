/**
 * A valid `creators` row for tests. Every ported test seeds through this so a schema
 * change is one edit, not thirty. Overrides win.
 */
import type { Id } from "../../convex/_generated/dataModel";

type InsertCtx = { db: { insert: (table: "creators", value: Record<string, unknown>) => Promise<Id<"creators">> } };

export function creatorRow(suffix: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = overrides.createdAt ?? Date.UTC(2026, 6, 3, 9, 0, 0);
  return {
    clerkUserId: `u_${suffix}`,
    email: `${suffix}@example.com`,
    handles: { tiktok: `tt_${suffix}` },
    ownership: "unverified",
    niche: "running and marathon training",
    timezone: "UTC",
    quietHours: { start: "22:00", end: "07:00" },
    tone: "friend",
    mode: "full",
    dossierVersion: 0,
    notes: [],
    affinities: [],
    experiments: [],
    channel: { paired: false },
    plan: { status: "trialing", founding: true },
    createdAt: now,
    ...overrides,
  };
}

export async function seedCreator(ctx: InsertCtx, suffix: string, overrides: Record<string, unknown> = {}): Promise<Id<"creators">> {
  return await ctx.db.insert("creators", creatorRow(suffix, overrides));
}
