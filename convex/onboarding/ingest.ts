/**
 * The catalogue read (plan §13.1). Pass one is code: profile, posts, baseline,
 * multiples. Pass two is transcripts for the sample. Pass three, watching, lands
 * with the Gemini client. Then one writer call synthesizes the dossier (§14.1),
 * validated by Zod before it is written. The job enqueues `first_read` at the end.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { DossierSchema, DOSSIER_JSON_SHAPE } from "../contracts/dossier";
import { SOUL } from "../agent/soul";

const TRANSCRIPT_CAP = 40; // tonight: transcripts for the sample only; the full-catalogue pass follows with batch

interface PostIn {
  platform: "tiktok" | "instagram";
  postId: string;
  url: string | null;
  caption: string | null;
  postedAt: number | null;
  metrics: { likeCount: number | null; commentCount: number | null; viewCount: number | null; shareCount: number | null; saveCount: number | null };
  mediaType: string;
  videoDurationSec: number | null;
}

export const creatorHandles = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"creators"> | null> => (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null,
});

/** Upsert own posts from a normalized page; returns how many were new. */
export const upsertOwnPosts = internalMutation({
  args: { creatorId: v.id("creators"), posts: v.any(), now: v.number() },
  handler: async (ctx, a): Promise<{ inserted: number; total: number }> => {
    const posts = a.posts as PostIn[];
    let inserted = 0;
    for (const p of posts) {
      if (!p.postId) continue;
      const existing = await ctx.db
        .query("ownPosts")
        .withIndex("by_post", (q) => q.eq("platform", p.platform).eq("postId", p.postId))
        .first();
      const metrics = {
        views: p.metrics.viewCount ?? 0,
        likes: p.metrics.likeCount ?? 0,
        comments: p.metrics.commentCount ?? 0,
        shares: p.metrics.shareCount ?? 0,
        saves: p.metrics.saveCount ?? undefined,
      };
      if (existing) {
        await ctx.db.patch(existing._id, { metrics, metricsAsOf: a.now });
        continue;
      }
      await ctx.db.insert("ownPosts", {
        creatorId: a.creatorId,
        platform: p.platform,
        postId: p.postId,
        url: p.url ?? "",
        createTime: p.postedAt ? (p.postedAt < 1e12 ? p.postedAt * 1000 : p.postedAt) : a.now,
        contentType: p.mediaType === "carousel" ? "carousel" : p.mediaType === "image" ? "photo" : "video",
        durationSec: p.videoDurationSec ?? undefined,
        caption: p.caption ?? "",
        hashtags: (p.caption ?? "").match(/#[\p{L}\p{N}_]+/gu)?.map((h) => h.slice(1).toLowerCase()) ?? [],
        metrics,
        metricsAsOf: a.now,
        source: "scrape",
      });
      inserted += 1;
    }
    const total = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()).length;
    return { inserted, total };
  },
});

/** Baseline = median views of the last 20 posts; every post gets a multiple against it. */
export const computeMultiples = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ baseline: number | null; posts: number }> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").collect()) as Doc<"ownPosts">[];
    if (rows.length === 0) return { baseline: null, posts: 0 };
    const last20 = rows.slice(0, 20).map((r) => r.metrics.views).sort((x, y) => x - y);
    const baseline = last20.length >= 5 ? last20[Math.floor(last20.length / 2)] : null;
    for (const r of rows) {
      await ctx.db.patch(r._id, { multiple: baseline && baseline > 0 ? Number((r.metrics.views / baseline).toFixed(2)) : undefined });
    }
    return { baseline, posts: rows.length };
  },
});

export const ownPostsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"ownPosts">[]> =>
    (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").collect()) as Doc<"ownPosts">[],
});

export const storeTranscript = internalMutation({
  args: { ownPostId: v.id("ownPosts"), transcript: v.string(), sample: v.array(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.ownPostId, { transcript: a.transcript, sample: a.sample });
    return null;
  },
});

export const writeDossier = internalMutation({
  args: { creatorId: v.id("creators"), dossier: v.any(), mode: v.union(v.literal("full"), v.literal("thin"), v.literal("newCreator")) },
  handler: async (ctx, a): Promise<{ version: number }> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators">;
    const version = (creator.dossierVersion ?? 0) + 1;
    await ctx.db.patch(a.creatorId, { dossier: { ...(a.dossier as object), version }, dossierVersion: version, mode: a.mode, updatedAt: Date.now() });
    return { version };
  },
});

/** Pick the sample to watch/transcribe (§13.1): latest 8, top 12, weakest 6, plus history spread. */
export function pickSample(rows: Doc<"ownPosts">[]): Map<Id<"ownPosts">, string[]> {
  const tags = new Map<Id<"ownPosts">, string[]>();
  const add = (r: Doc<"ownPosts">, t: string) => tags.set(r._id, [...(tags.get(r._id) ?? []), t]);
  const byTime = [...rows].sort((a, b) => b.createTime - a.createTime);
  byTime.slice(0, 8).forEach((r) => add(r, "recent"));
  const withMultiple = rows.filter((r) => r.multiple !== undefined);
  [...withMultiple].sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0)).slice(0, 12).forEach((r) => add(r, "top"));
  const twoDays = Date.now() - 48 * 3600 * 1000;
  [...withMultiple].filter((r) => r.createTime < twoDays).sort((a, b) => (a.multiple ?? 0) - (b.multiple ?? 0)).slice(0, 6).forEach((r) => add(r, "weak"));
  if (byTime.length > 40) {
    const older = byTime.slice(40);
    const step = Math.max(1, Math.floor(older.length / 8));
    for (let i = 0; i < older.length && tags.size < TRANSCRIPT_CAP; i += step) add(older[i], "history");
  }
  return tags;
}

export const run = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const creator = await ctx.runQuery(internal.onboarding.ingest.creatorHandles, { creatorId: args.creatorId });
    if (!creator) return { ok: false, reason: "creator not found" };
    const now = Date.now();
    const platforms = (["tiktok", "instagram"] as const).filter((p) => creator.handles[p]);
    if (platforms.length === 0) return { ok: false, reason: "no handles to read" };

    // Pass one: the catalogue. Popular first so the all-time top posts are in the set, then latest.
    let readFrom = { tiktokPosts: 0, instagramPosts: 0, transcripts: 0, watched: 0, sampledFromHistory: false };
    for (const platform of platforms) {
      const handle = creator.handles[platform]!;
      for (const sort of ["popular", "latest"] as const) {
        try {
          const r = await ctx.runAction(internal.reads.read.read, {
            kind: "account.posts",
            params: { platform, handle, sort, slot: "onboarding" },
            creatorId: creator._id,
          });
          const posts = (Array.isArray(r.value) ? r.value : []) as PostIn[];
          const { inserted } = await ctx.runMutation(internal.onboarding.ingest.upsertOwnPosts, { creatorId: creator._id, posts, now });
          if (platform === "tiktok") readFrom.tiktokPosts += inserted;
          else readFrom.instagramPosts += inserted;
        } catch (err) {
          console.error(`[ingest] ${platform}/${sort} read failed: ${String(err)}`);
        }
      }
    }
    const { baseline, posts } = await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId: creator._id });
    const mode: "full" | "thin" | "newCreator" = posts <= 4 ? "newCreator" : posts <= 30 ? "thin" : "full";

    // Pass two: transcripts for the sample.
    const rows = await ctx.runQuery(internal.onboarding.ingest.ownPostsFor, { creatorId: creator._id });
    const sample = pickSample(rows);
    readFrom.sampledFromHistory = [...sample.values()].some((t) => t.includes("history"));
    let transcribed = 0;
    for (const row of rows) {
      const tags = sample.get(row._id);
      if (!tags || transcribed >= TRANSCRIPT_CAP || row.contentType !== "video" || !row.url) continue;
      try {
        const r = await ctx.runAction(internal.reads.read.read, {
          kind: "post.transcript",
          params: { platform: row.platform, url: row.url },
          creatorId: creator._id,
        });
        const t = (r.value as { transcript?: string | null } | null)?.transcript ?? null;
        await ctx.runMutation(internal.onboarding.ingest.storeTranscript, { ownPostId: row._id, transcript: t ?? "", sample: tags });
        if (t) transcribed += 1;
      } catch (err) {
        console.error(`[ingest] transcript failed for ${row.url}: ${String(err)}`);
      }
    }
    readFrom.transcripts = transcribed;

    // Synthesis: one writer call over everything, validated before it is written.
    const fresh = await ctx.runQuery(internal.onboarding.ingest.ownPostsFor, { creatorId: creator._id });
    const digest = fresh.slice(0, 200).map((r) => ({
      id: r.postId,
      platform: r.platform,
      when: new Date(r.createTime).toISOString().slice(0, 10),
      type: r.contentType,
      sec: r.durationSec ?? null,
      views: r.metrics.views,
      multiple: r.multiple ?? null,
      caption: r.caption.slice(0, 200),
      transcript: r.transcript ? r.transcript.slice(0, 600) : null,
      sample: r.sample ?? null,
    }));
    const system = `${SOUL}\n\n# Skill: learn-creator\nYou are writing the creator's dossier from their own posts. Every claim must cite post ids from the data. Say "unknown" where the data is silent. Do not invent visuals: you have captions, transcripts and numbers only tonight. Output ONLY JSON matching this shape:\n${DOSSIER_JSON_SHAPE}`;
    const user = `Creator handles: ${JSON.stringify(creator.handles)}\nTheir sentence about what they make: ${JSON.stringify(creator.niche)}\nMode: ${mode} (posts read: ${posts}, baseline median views of last 20: ${baseline ?? "unknown"})\n\nPosts (newest first):\n${JSON.stringify(digest)}`;
    const spec = REGISTRY.writer;
    let result = await callModel(ctx, { creatorId: creator._id, purpose: "learn_creator", model: spec.primary, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.3, maxTokens: 3000, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    if (!result.ok) result = await callModel(ctx, { creatorId: creator._id, purpose: "learn_creator_fallback", model: spec.fallback, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.3, maxTokens: 3000, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    if (!result.ok) return { ok: false, reason: `dossier synthesis failed: ${result.reason}` };

    const parsed = parseDossier(result.content, { readFrom, mode });
    if (!parsed.ok) return { ok: false, reason: `dossier did not validate: ${parsed.error}` };

    await ctx.runMutation(internal.onboarding.ingest.writeDossier, { creatorId: creator._id, dossier: parsed.dossier, mode });
    await ctx.runMutation(internal.core.jobs.enqueue, {
      kind: "first_read",
      idempotencyKey: `first_read:${creator._id}:after_ingest`,
      creatorId: creator._id,
      payloadJson: JSON.stringify({ after: "ingest" }),
    });
    return { ok: true };
  },
});

/** Extract the JSON object from a completion (models wrap it in fences) and validate. */
export function parseDossier(content: string, fill: { readFrom: Record<string, number | boolean>; mode: "full" | "thin" | "newCreator" }): { ok: true; dossier: unknown } | { ok: false; error: string } {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: "no JSON object in completion" };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, error: `JSON parse: ${String(e)}` };
  }
  const candidate = { version: 0, rewrittenAt: new Date().toISOString(), readFrom: fill.readFrom, mode: fill.mode, ...obj };
  const r = DossierSchema.safeParse(candidate);
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, dossier: r.data };
}
