/**
 * What their posts are about, grouped (plan Sprint 4f): the scattered detector and the
 * evidence for the lane proposal, in one object on the creator row.
 *
 * Grouping is code: embeddings we already run, cosine, one threshold. Naming is one cheap
 * model call over the groups' captions, with a deterministic fallback from the group's own
 * words so a model outage never leaves a cluster unnamed. Nothing here writes a lane; it
 * only says what is there.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { cosineSimilarity, COSINE_CLUSTER_THRESHOLD } from "../core/embeddings";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";

export const CLUSTERS = {
  /** A cluster is real from this many posts; a single post is a post, not a direction. */
  minPosts: 2,
  /** No cluster holding this share of the posts means the account is scattered. */
  scatteredBelow: 1 / 3,
  maxClusters: 6,
  /** Text per post handed to the embedder and the namer. */
  textChars: 240,
} as const;

export interface ClusterIn { postId: string; text: string; vector: number[] | null; multiple: number | null; hashtags: string[] }
export interface Cluster { label: string; keywords: string[]; postIds: string[]; share: number; medianMultiple: number | null }
export interface Lanes { readAt: number; posts: number; scatter: number; state: "known" | "unnamed" | "scattered" | "none"; clusters: Cluster[]; /** How many posts the embedder failed on; a read with failures is a weaker read and says so. */ embedFailed?: number; /** The words of the accounts they admire, read at onboarding so the split question can fire on day one. */ admiredKeywords?: string[] }

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round((s[Math.floor(s.length / 2)] ?? 0) * 100) / 100 : null; };

/** Pure: greedy single-link grouping over cosine. Posts without a vector each stand alone and are dropped as singletons. */
export function clusterPosts(posts: ClusterIn[], threshold = COSINE_CLUSTER_THRESHOLD): Array<{ members: ClusterIn[] }> {
  const groups: Array<{ members: ClusterIn[]; centroid: number[] | null }> = [];
  for (const p of posts) {
    if (!p.vector) { groups.push({ members: [p], centroid: null }); continue; }
    let best: { g: (typeof groups)[number]; sim: number } | null = null;
    for (const g of groups) {
      if (!g.centroid) continue;
      const sim = cosineSimilarity(p.vector, g.centroid);
      if (sim >= threshold && (!best || sim > best.sim)) best = { g, sim };
    }
    if (best) {
      best.g.members.push(p);
      const n = best.g.members.length;
      best.g.centroid = best.g.centroid!.map((x, i) => (x * (n - 1) + p.vector![i]) / n);
    } else groups.push({ members: [p], centroid: [...p.vector] });
  }
  return groups.sort((a, b) => b.members.length - a.members.length).map((g) => ({ members: g.members }));
}

/** Pure: the words a group uses most, hashtags first, for a fallback name and the keywords. */
export function groupWords(members: ClusterIn[], stop: ReadonlySet<string>): string[] {
  const score = new Map<string, number>();
  const bump = (raw: string, w: number) => { const k = raw.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9]/g, ""); if (k.length < 4 || stop.has(k)) return; score.set(k, (score.get(k) ?? 0) + w); };
  for (const m of members) { for (const h of m.hashtags) bump(h, 2); for (const w of m.text.split(/[^A-Za-z0-9']+/)) bump(w, 0.5); }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
}

/** Pure: the lanes object from groups. */
export function lanesFrom(groups: Array<{ members: ClusterIn[]; label?: string; keywords?: string[] }>, total: number, now: number, stop: ReadonlySet<string>): Lanes {
  const real = groups.filter((g) => g.members.length >= CLUSTERS.minPosts).slice(0, CLUSTERS.maxClusters);
  const clusters: Cluster[] = real.map((g) => {
    const words = groupWords(g.members, stop);
    return { label: g.label ?? words.slice(0, 2).join(" ") ?? "untitled", keywords: g.keywords?.length ? g.keywords : words, postIds: g.members.map((m) => m.postId), share: Math.round((g.members.length / Math.max(1, total)) * 100) / 100, medianMultiple: med(g.members.map((m) => m.multiple).filter((x): x is number => x !== null)) };
  });
  const top = clusters[0]?.share ?? 0;
  const scatter = Math.round((1 - top) * 100) / 100;
  const state: Lanes["state"] = total === 0 ? "none" : clusters.length === 0 || top < CLUSTERS.scatteredBelow ? "scattered" : "unnamed";
  return { readAt: now, posts: total, scatter, state, clusters };
}

const STOP = new Set(["this", "that", "with", "have", "from", "your", "just", "what", "when", "they", "them", "there", "here", "will", "about", "more", "some", "than", "then", "over", "only", "also", "very", "really", "much", "many", "make", "made", "know", "think", "thing", "things", "people", "because", "where", "which", "while", "still", "even", "ever", "never", "always", "every", "part", "best", "good", "great", "love", "time", "today", "want", "need", "going", "back", "down", "come", "came", "does", "doing", "done", "dont", "into", "like", "fyp", "foryou", "foryoupage", "viral", "trending", "tiktok", "reels", "instagram", "video", "post", "follow", "explore", "capcut"]);

export const postsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ postId: string; text: string; multiple: number | null; hashtags: string[] }>> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPosts">[];
    return rows.map((p) => ({ postId: p.postId, text: `${p.caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim()} ${(p.transcript ?? "").slice(0, 160)}`.trim().slice(0, CLUSTERS.textChars), multiple: p.reachMultiple ?? p.multiple ?? null, hashtags: p.hashtags }));
  },
});

export const rosterFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ platform: "tiktok" | "instagram"; handle: string }>> => {
    const rows = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(12)) as Doc<"trackedAccounts">[];
    return rows.filter((r) => r.status !== "removed").map((r) => ({ platform: r.platform, handle: r.handle }));
  },
});

export const write = internalMutation({
  args: { creatorId: v.id("creators"), lanes: v.any() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.creatorId, { lanes: a.lanes as Lanes, updatedAt: Date.now() });
    return null;
  },
});

/** Read the clusters for one creator and store them. Cheap: one embed batch, one naming call. */
export const read = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Lanes> => {
    const posts = await ctx.runQuery(internal.onboarding.clusters.postsFor, { creatorId: a.creatorId });
    const now = Date.now();
    const withText = posts.filter((p) => p.text.length >= 8);
    const emb = withText.length ? await ctx.runAction(internal.core.embeddings.embedTexts, { texts: withText.map((p) => p.text) }) : { vectors: [], failed: 0 };
    const vec = new Map(emb.vectors.map((x) => [x.text, x.values]));
    if (emb.failed > 0) console.error(`[clusters] embedder failed on ${emb.failed} of ${withText.length} posts; those stand alone this read`);
    const input: ClusterIn[] = posts.map((p) => ({ ...p, vector: vec.get(p.text) ?? null }));
    const groups = clusterPosts(input);
    const real = groups.filter((g) => g.members.length >= CLUSTERS.minPosts).slice(0, CLUSTERS.maxClusters);
    // Name the groups once, from their own words; fall back to the words themselves.
    let names: Array<{ label: string; keywords: string[] }> = [];
    if (real.length) {
      const spec = REGISTRY.classifier;
      const messages = [
        { role: "system" as const, content: "You name groups of a creator's own posts. For each group, a two-to-four word label a person would use (\"solo dev builds\", \"london runs\", \"food reviews\") and up to four lowercase keywords. Output ONLY JSON: {\"groups\":[{\"label\":\"\",\"keywords\":[\"\"]}]} in the same order." },
        { role: "user" as const, content: real.map((g, i) => `group ${i + 1} (${g.members.length} posts):\n${g.members.slice(0, 6).map((m) => `- ${m.text.slice(0, 140)}`).join("\n")}`).join("\n\n") },
      ];
      let r = await callModel(ctx, { creatorId: a.creatorId, purpose: "name_clusters", model: spec.primary, temperature: 0.2, maxTokens: 600, timeoutMs: 20_000, messages, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (!r.ok) r = await callModel(ctx, { creatorId: a.creatorId, purpose: "name_clusters_fallback", model: spec.fallback, temperature: 0.2, maxTokens: 600, timeoutMs: 20_000, messages, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (r.ok) {
        try { const j = JSON.parse(r.content.slice(r.content.indexOf("{"), r.content.lastIndexOf("}") + 1)) as { groups?: Array<{ label?: string; keywords?: string[] }> }; names = (j.groups ?? []).map((g) => ({ label: String(g.label ?? "").slice(0, 40), keywords: (g.keywords ?? []).map(String).slice(0, 4) })); } catch { names = []; }
      }
    }
    const lanes = lanesFrom(real.map((g, i) => ({ members: g.members, label: names[i]?.label || undefined, keywords: names[i]?.keywords })), posts.length, now, STOP);
    // Who they wish they were, in words, on day one: the roster's recent posts (cached reads,
    // one credit each at most), before the sweep has sampled anyone. A failed read is skipped.
    const roster = await ctx.runQuery(internal.onboarding.clusters.rosterFor, { creatorId: a.creatorId });
    const score = new Map<string, number>();
    for (const acct of roster.slice(0, 8)) {
      try {
        const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform: acct.platform, handle: acct.handle, sort: "popular", slot: "onboarding" }, creatorId: a.creatorId });
        const theirs = (Array.isArray(r.value) ? r.value : []) as Array<{ caption?: string | null }>;
        const members: ClusterIn[] = theirs.slice(0, 20).map((p, i) => ({ postId: `${acct.handle}:${i}`, text: (p.caption ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").slice(0, CLUSTERS.textChars), vector: null, multiple: null, hashtags: (p.caption ?? "").match(/#[\p{L}\p{N}_]+/gu)?.map((h) => h.slice(1)) ?? [] }));
        for (const w of groupWords(members, STOP)) score.set(w, (score.get(w) ?? 0) + 1);
      } catch (err) {
        console.error(`[clusters] roster read failed for @${acct.handle}: ${String(err).slice(0, 120)}`);
      }
    }
    lanes.embedFailed = emb.failed;
    lanes.admiredKeywords = [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k]) => k);
    await ctx.runMutation(internal.onboarding.clusters.write, { creatorId: a.creatorId, lanes });
    return lanes;
  },
});
