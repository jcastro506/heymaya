/**
 * profile-creator (plan §11.2 "why is this creator growing", on demand). They name an
 * account; code reads its profile and recent posts through the cache, computes the
 * plain facts (cadence, normal, the outliers, length), pulls the transcripts of the
 * top three, and the writer answers in four lines: what they do, what is working
 * right now with numbers, what of it is this creator's to take, what is not.
 * Nothing about visuals: nobody watched anything here.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique, tooLong } from "./critic";
import { deliverNow } from "../core/scheduler";
import { investigate } from "./investigate";

export const PROFILE_SKILL = `profile-creator
When: they asked why an account is growing, or what an account is doing. You have that account's recent posts with numbers and the transcripts of its top three. You have NOT watched anything, so say nothing about visuals.
Four lines, no bullets: (1) what this account actually does, from the captions and transcripts; (2) what is working right now, with the numbers you were given (posting cadence, their normal, the outliers and how far above); (3) what of it is THIS creator's to take, given the dossier and their taste; (4) what is not theirs, and why. Under 600 characters. Never invent a metric.
Output ONLY JSON: {"message": "≤600 chars in your voice", "takeaway": "≤120, the one transferable thing"}`;

type PostIn = { postId?: string; url?: string; createTime?: number; caption?: string; durationSec?: number; metrics?: { viewCount?: number; likeCount?: number; commentCount?: number; shareCount?: number } };

export function facts(posts: PostIn[]): { count: number; perWeek: number | null; medianViews: number | null; outliers: Array<{ url: string; views: number; multiple: number; caption: string; sec: number | null }>; medianSec: number | null } {
  const withViews = posts.filter((p) => (p.metrics?.viewCount ?? 0) > 0);
  const views = withViews.map((p) => p.metrics!.viewCount!).sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)] : null;
  const times = posts.map((p) => p.createTime ?? 0).filter(Boolean).sort((a, b) => a - b);
  const spanDays = times.length >= 2 ? (times[times.length - 1] - times[0]) / 86_400_000 : 0;
  const perWeek = spanDays >= 3 ? Math.round((times.length / spanDays) * 7 * 10) / 10 : null;
  const secs = posts.map((p) => p.durationSec ?? 0).filter(Boolean).sort((a, b) => a - b);
  const outliers = median
    ? withViews.map((p) => ({ url: p.url ?? "", views: p.metrics!.viewCount!, multiple: Math.round((p.metrics!.viewCount! / median) * 10) / 10, caption: (p.caption ?? "").slice(0, 120), sec: p.durationSec ?? null })).filter((o) => o.multiple >= 2).sort((a, b) => b.multiple - a.multiple).slice(0, 3)
    : [];
  return { count: posts.length, perWeek, medianViews: median, outliers, medianSec: secs.length ? secs[Math.floor(secs.length / 2)] : null };
}

export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), platform: v.union(v.literal("tiktok"), v.literal("instagram")), handle: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g || !g.target) return { ok: false, reason: "message not found" };
    const { creator, directives, target } = g;
    const handle = a.handle.replace(/^@/, "").toLowerCase();
    const reply = async (body: string, extra: { produced?: ReturnType<typeof producedStamp>; criticSkipped?: boolean } = {}) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `profile:${a.messageId}`, proactive: false, kind: "reply", ...extra });
      await deliverNow(ctx as never);
    };

    let posts: PostIn[] = [];
    try {
      const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform: a.platform, handle, sort: "latest", slot: "profile" }, creatorId: creator._id });
      posts = (Array.isArray(r.value) ? r.value : []) as PostIn[];
    } catch (e) {
      await reply(`couldn't read @${handle} just now (${e instanceof Error ? e.message.slice(0, 60) : "no answer"}). private account, typo, or the platform is being slow; try again in a bit.`);
      return { ok: true, reason: "read failed" };
    }
    if (posts.length === 0) {
      await reply(`@${handle} came back empty. private, brand new, or not the handle you meant?`);
      return { ok: true, reason: "no posts" };
    }
    const f = facts(posts);
    const transcripts: Array<{ url: string; transcript: string }> = [];
    for (const o of f.outliers.slice(0, 3)) {
      if (!o.url) continue;
      try {
        const t = await ctx.runAction(internal.reads.read.read, { kind: "post.transcript", params: { platform: a.platform, url: o.url }, creatorId: creator._id });
        const text = (t.value as { transcript?: string | null } | null)?.transcript ?? null;
        if (text) transcripts.push({ url: o.url, transcript: text.slice(0, 900) });
      } catch {
        /* a missing transcript is a missing citation, not a failure */
      }
    }
    const evidence = { handle: `@${handle}`, platform: a.platform, theirQuestion: target.body.slice(0, 300), facts: f, recentCaptions: posts.slice(0, 12).map((p) => ({ when: p.createTime ? new Date(p.createTime).toISOString().slice(0, 10) : null, views: p.metrics?.viewCount ?? null, caption: (p.caption ?? "").slice(0, 140) })), transcripts };
    const prefix = buildPrefix({ creator, directives, skill: PROFILE_SKILL });
    const spec = REGISTRY.writer;
    const inv = await investigate(ctx, { creatorId: creator._id, purpose: "profile_creator", prefix, user: `Evidence (everything you may cite):\n${JSON.stringify(evidence)}`, budget: { calls: 4, credits: 20, deadlineAt: Date.now() + 45_000 }, temperature: 0.4, maxTokens: 1200 });
    const r = inv.content ? { ok: true as const, content: inv.content } : { ok: false as const, content: "" };
    let out: { message?: string } | null = null;
    if (r.ok) {
      try {
        const m = r.content.match(/\{[\s\S]*\}/);
        out = m ? (JSON.parse(m[0]) as { message?: string }) : null;
      } catch {
        out = null;
      }
    }
    if (!out?.message?.trim()) {
      await reply(`i read @${handle} but couldn't put it together in a way i'd stand behind. ask me again in a minute.`);
      return { ok: true, reason: "no message" };
    }
    const dossierVoice = creator.dossier as { voice?: unknown; persona?: unknown } | undefined;
    let text = out.message.trim();
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "profile", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rw = await callModel(ctx, { creatorId: creator._id, purpose: "profile_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `Evidence:\n${JSON.stringify(evidence)}\n\nYour previous answer was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite ONLY the message text, fixing exactly that. Output the text only.` }], temperature: 0.4, maxTokens: 800, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rw.ok && rw.content.trim()) {
        text = rw.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over" } : await critique(ctx, { creatorId: creator._id, kind: "profile", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      if (!verdict.pass) {
        await reply(`i have a read on @${handle} but it didn't pass my own check. give me a minute and ask again.`);
        return { ok: true, reason: `critic: ${verdict.problems.join(", ")}` };
      }
    }
    await reply(text, { produced: producedStamp(spec.primary), criticSkipped });
    return { ok: true };
  },
});
