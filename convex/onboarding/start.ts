/**
 * Web onboarding entry points (plan §7 S2). The web collects; the rows drive
 * everything. The catalogue read starts the moment handles are known (screen 2),
 * so nothing waits on the Telegram step.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";

const handleShape = v.object({ tiktok: v.optional(v.string()), instagram: v.optional(v.string()) });

function cleanHandle(h: string | undefined): string | undefined {
  const c = h?.trim().replace(/^@/, "").toLowerCase();
  return c && /^[a-z0-9._]{1,40}$/.test(c) ? c : undefined;
}

/** Screen 2: create (or update) the creator row from their handles. Idempotent per Clerk user. */
export const start = mutation({
  args: { handles: handleShape, timezone: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; creatorId?: string; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };
    const handles = { tiktok: cleanHandle(args.handles.tiktok), instagram: cleanHandle(args.handles.instagram) };
    if (!handles.tiktok && !handles.instagram) return { ok: false, error: "one handle is required" };

    // One creator per handle: a second signup with the same handle is a merge prompt, never a second row.
    for (const platform of ["tiktok", "instagram"] as const) {
      const h = handles[platform];
      if (!h) continue;
      const taken = (await ctx.db
        .query("creators")
        .withIndex(platform === "tiktok" ? "by_tiktok" : "by_instagram", (q) => q.eq(platform === "tiktok" ? "handles.tiktok" : "handles.instagram", h))
        .first()) as Doc<"creators"> | null;
      if (taken && taken.clerkUserId !== identity.subject) return { ok: false, error: `@${h} is already set up with another account` };
    }

    const existing = (await ctx.db
      .query("creators")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject))
      .first()) as Doc<"creators"> | null;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { handles, timezone: args.timezone ?? existing.timezone, updatedAt: now });
      return { ok: true, creatorId: existing._id };
    }
    const creatorId = await ctx.db.insert("creators", {
      clerkUserId: identity.subject,
      email: identity.email ?? "",
      handles,
      ownership: "unverified",
      niche: "",
      timezone: args.timezone ?? "America/Los_Angeles",
      quietHours: { start: "22:00", end: "07:00" },
      tone: "friend",
      mode: "full",
      dossierVersion: 0,
      notes: [],
      affinities: [],
      experiments: [],
      channel: { paired: false },
      plan: { status: "onboarding", founding: true },
      createdAt: now,
    });
    // The read starts now; the first message waits on pairing, not on this.
    await ctx.runMutation(internal.core.jobs.enqueue, {
      kind: "ingest_catalogue",
      idempotencyKey: `ingest:${creatorId}:v0`,
      creatorId,
      payloadJson: JSON.stringify({ reason: "onboarding" }),
    });
    return { ok: true, creatorId };
  },
});

/** Screen 4: their sentence. Screen 7: timezone and quiet hours. */
export const describe = mutation({
  args: { niche: v.optional(v.string()), timezone: v.optional(v.string()), quietHours: v.optional(v.object({ start: v.string(), end: v.string() })), tone: v.optional(v.union(v.literal("coach"), v.literal("friend"), v.literal("blunt"))) },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, error: "sign in first" };
    const creator = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
    if (!creator) return { ok: false, error: "start with your handles first" };
    const patch: Partial<Doc<"creators">> = { updatedAt: Date.now() };
    if (args.niche !== undefined) patch.niche = args.niche.trim().slice(0, 300);
    if (args.timezone) patch.timezone = args.timezone;
    if (args.quietHours) patch.quietHours = args.quietHours;
    if (args.tone) patch.tone = args.tone;
    await ctx.db.patch(creator._id, patch);
    return { ok: true };
  },
});

/** Screen 7 and the Today tab: what has she read so far. Reactive. */
export const progress = query({
  args: {},
  handler: async (ctx): Promise<{ state: "none" | "reading" | "read" | "paired"; posts: number; transcripts: number; dossier: boolean; paired: boolean; ingest: string | null; firstRead: string | null; timezone: string; quietHours: { start: string; end: string } } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = (await ctx.db.query("creators").withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", identity.subject)).first()) as Doc<"creators"> | null;
    if (!creator) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"ownPosts">[];
    const transcripts = posts.filter((p) => p.transcript).length;
    const dossier = Boolean(creator.dossier);
    const paired = creator.channel.paired;
    const jobs = (await ctx.db.query("jobs").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect()) as Doc<"jobs">[];
    const ingest = jobs.filter((j) => j.kind === "ingest_catalogue").sort((x, y) => y.createdAt - x.createdAt)[0];
    const firstRead = jobs.filter((j) => j.kind === "first_read").sort((x, y) => y.createdAt - x.createdAt)[0];
    return { state: paired ? "paired" : dossier ? "read" : posts.length ? "reading" : "none", posts: posts.length, transcripts, dossier, paired, ingest: ingest?.status ?? null, firstRead: firstRead?.status ?? null, timezone: creator.timezone, quietHours: creator.quietHours };
  },
});
