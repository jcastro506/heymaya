/**
 * The onboarding read, on real accounts (2026-09-29). Signs each handle up the way the app does
 * (`startCreator`: the real ingest job, the real watching, the real profile, then the favorites),
 * and reports what she read, watched, wrote about them and proposed, with timings. Dev only; test
 * creators are "eval-run:or-<run>:<i>" and nothing here touches anyone else. Spends vendor credits:
 * about 1 + 2 per platform, 1 per transcript and 10 per watched post, per creator.
 *
 *   export CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997
 *   npx convex run eval/onboardingRead:start '{"subjects":[{"tiktok":"x","note":"cooking"}],"watchCap":12}'
 *   npx convex run eval/onboardingRead:report '{"runId":"or-..."}'
 *   npx convex run eval/onboardingRead:clear '{"runId":"or-..."}'
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { startCreator } from "../onboarding/start";
import { TABLES_BY_CREATOR } from "../account/deletion";
import { CREATOR_INDEX } from "./livingSim";

export const OR_PREFIX = "eval-run:or-";
const subjectFor = (runId: string, i: number) => `eval-run:${runId}:${i}`;

async function runCreators(ctx: { db: { query: (t: "creators") => unknown } }, runId: string): Promise<Doc<"creators">[]> {
  if (!/^or-[a-z0-9]+$/.test(runId)) throw new Error("not an onboarding-read run id");
  const prefix = `eval-run:${runId}:`;
  const q = ctx.db.query("creators") as { withIndex: (i: string, f: (q: { gte: (k: string, v: string) => { lt: (k: string, v: string) => unknown } }) => unknown) => { collect: () => Promise<Doc<"creators">[]> } };
  return await q.withIndex("by_clerkUserId", (x) => x.gte("clerkUserId", prefix).lt("clerkUserId", `${prefix}~`)).collect();
}

export const start = internalMutation({
  args: {
    subjects: v.array(v.object({ tiktok: v.optional(v.string()), instagram: v.optional(v.string()), note: v.optional(v.string()) })),
    watchCap: v.optional(v.number()),
    transcriptCap: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<{ runId: string; started: Array<{ i: number; handles: string; ok: boolean; error?: string }>; estimatedCredits: number }> => {
    if (process.env.ENVIRONMENT_NAME === "production") throw new Error("the onboarding-read sim never runs on production");
    const runId = `or-${Date.now().toString(36)}`;
    const watchCap = Math.max(0, Math.min(40, a.watchCap ?? 12));
    const transcriptCap = Math.max(0, Math.min(40, a.transcriptCap ?? 12));
    const started = [];
    let estimatedCredits = 0;
    for (const [i, s] of a.subjects.entries()) {
      const r = await startCreator(ctx, { subject: subjectFor(runId, i), email: `${runId}-${i}@eval.invalid`, handles: { tiktok: s.tiktok, instagram: s.instagram }, timezone: "America/New_York", ingestCaps: { watchCap, transcriptCap } });
      const platforms = (s.tiktok ? 1 : 0) + (s.instagram ? 1 : 0);
      estimatedCredits += platforms * 3 + transcriptCap + 10 * watchCap + 40; // + the favorites' candidate reads
      started.push({ i, handles: [s.tiktok && `tt:@${s.tiktok}`, s.instagram && `ig:@${s.instagram}`].filter(Boolean).join(" ") + (s.note ? ` (${s.note})` : ""), ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    }
    return { runId, started, estimatedCredits };
  },
});

type Profile = { readFrom?: Record<string, number | boolean>; rewrittenAt?: string; mode?: string; persona?: { summary?: string; onCamera?: string; register?: string }; themes?: Array<{ label: string; share: number }>; formatsUsed?: Array<{ label: string; count: number; medianMultiple: number | null }>; works?: Array<{ claim: string }>; doesNot?: Array<{ claim: string }>; keywords?: string[]; audience?: { whoComments?: string }; fingerprint?: { opening?: string; medianCutSeconds?: number | string; energy?: string; confidence?: number } };

export const report = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, a) => {
    const rows = await runCreators(ctx, a.runId);
    return rows.map((c) => {
      const d = c.dossier as Profile | undefined;
      const secs = (t: number | undefined) => (t ? Math.round((t - (c.createdAt ?? c._creationTime)) / 1000) : null);
      return {
        i: Number(c.clerkUserId.split(":").pop()),
        handles: c.handles,
        state: !d ? "reading" : !c.picks ? "profile written, picks pending" : "done",
        secondsToProfile: d?.rewrittenAt ? secs(Date.parse(d.rewrittenAt)) : null,
        secondsToPicks: secs(c.picks?.at),
        read: d?.readFrom ?? null,
        mode: d?.mode ?? null,
        profile: d ? {
          summary: d.persona?.summary, onCamera: d.persona?.onCamera, register: d.persona?.register,
          themes: (d.themes ?? []).map((t) => `${t.label} ${Math.round(t.share * 100)}%`),
          formats: (d.formatsUsed ?? []).map((f) => `${f.label} (${f.count} posts${f.medianMultiple !== null ? `, ${f.medianMultiple}x` : ""})`),
          works: (d.works ?? []).map((w) => w.claim), doesNot: (d.doesNot ?? []).map((w) => w.claim),
          audience: d.audience?.whoComments, fingerprint: d.fingerprint, keywords: d.keywords,
        } : null,
        picks: (c.picks?.items ?? []) as Array<{ platform: string; handle: string; followers: number | null; why: string }>,
      };
    });
  },
});

export const clear = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, a): Promise<{ deleted: number; done: boolean }> => {
    let deleted = 0;
    for (const c of await runCreators(ctx, a.runId)) {
      if (!c.clerkUserId.startsWith(OR_PREFIX)) throw new Error("refusing to delete a creator outside the simulation");
      for (const table of TABLES_BY_CREATOR) {
        const index = CREATOR_INDEX[table];
        if (!index || table === "schedule") continue;
        const q = ctx.db.query(table) as unknown as { withIndex: (i: string, f: (q: { eq: (k: string, v: unknown) => unknown }) => unknown) => { take: (n: number) => Promise<Array<{ _id: never }>> } };
        const rows = await q.withIndex(index, (x) => x.eq("creatorId", c._id as Id<"creators">)).take(400 - deleted);
        for (const r of rows) { await ctx.db.delete(r._id); deleted++; }
        if (deleted >= 400) return { deleted, done: false };
      }
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted, done: true };
  },
});
