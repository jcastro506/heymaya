/**
 * The opinion skill (plan §11.2 #10, §14.6, §13.6) and its cousins: a link to someone
 * else's post, a draft file, a link to their own post (`explain-post`, #9), an
 * analytics screenshot (`read-screenshot`, #12) and a voice note. Evidence is
 * gathered by code, watched by Gemini, and the writer gives one grounded read with a
 * confidence in words and a `predictions` row, so the track record is a table, not
 * a feeling. An opinion with zero citations is not sent.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY, WATCH_MODEL_TOP } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique, tooLong } from "./critic";
import { deliverNow } from "../core/scheduler";
import { fetchMedia, watchMedia } from "../integrations/gemini/client";
import { WATCH_PROMPT } from "../onboarding/watch";
import type { ParsedLink } from "./inbound";

export const CONFIDENCE_MULTIPLE: Record<string, number> = { strong: 1.8, solid: 1.3, fine: 1.0, weak: 0.7, broken: 0.4 }; // §13.6 (tune)

export const OPINION_SKILL = `opinion
When: they sent a draft, a link, or asked "will this go viral". You are giving a read, not a verdict, and you never promise a number.
The judgment: what the video does in its first three seconds against what has worked for THEM (their own top posts, the dossier) and what you know of their lane; their own history with this structure; the three highest-leverage fixes in order; a confidence in one word from strong | solid | fine | weak | broken, calibrated to their own baseline (fine = about their normal); and what you cannot know (watch time, the algorithm's mood, whether the sound is cleared).
Tone: the same as always. If the card says one thing and their caption implies another (an ironic caption on a straight video is a bit, not a mistake), read it as the bit. A draft with a copyrighted sound: "fine if it's in the app's library".
Cite: at least one number you were actually given (their multiple on a comparable post, a stat from the card, their normal). No number you weren't given.
Output ONLY JSON:
{"message": "≤700 chars, in your voice, the read then the three fixes then the confidence word in a sentence, no bullets", "biggest": "≤200", "second": "≤200", "fine": "≤120 what already works", "confidence": "strong|solid|fine|weak|broken", "citations": [{"stat": "", "value": "", "sampleSize": 0}], "cannotKnow": "≤160"}`;

export const EXPLAIN_POST_SKILL = `explain-post
When: they sent a link to their OWN post. Four lines, not four paragraphs: what it did against their normal (a number they were given), the one thing most likely responsible, one thing to keep, one thing to change next time. If the numbers are too fresh to mean anything (under 48 hours), say so and say when you'll know. Never invent a metric.
Output ONLY JSON: {"message": "≤500 chars, in your voice", "biggest": "≤200", "second": "≤200", "fine": "≤120", "confidence": "strong|solid|fine|weak|broken", "citations": [{"stat": "", "value": "", "sampleSize": 0}], "cannotKnow": "≤160"}`;

const SCREENSHOT_PROMPT = `This is a screenshot from a creator's phone: analytics, a profile, or a post. Read every number you can see with its label, exactly as written. Return STRICT JSON: {"kind": "analytics|profile|post|other", "platform": "tiktok|instagram|unknown", "numbers": [{"label": "", "value": ""}], "postTitleOrCaption": "≤120 or ''", "period": "≤40 or ''"}. If a number is unreadable, leave it out. Never guess.`;

const TRANSCRIBE_PROMPT = `Transcribe this voice note verbatim. Output only the words spoken, no labels.`;

interface Card { firstSecond?: string; firstThree?: string; [k: string]: unknown }
type OwnPost = { id: Id<"ownPosts">; url: string; views: number; multiple: number | null; metricsAsOf: number; createTime: number; caption: string };

export const ownHistory = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ posts: Array<{ url: string; views: number; multiple: number | null; caption: string; createTime: number }>; normal: number | null; predictions: Array<{ confidence: string; outcome: number | null }> }> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    const withMultiple = posts.filter((p) => p.multiple !== undefined);
    const top = [...withMultiple].sort((x, y) => (y.multiple ?? 0) - (x.multiple ?? 0)).slice(0, 5);
    const recent = posts.slice(0, 5);
    const pick = new Map<string, Doc<"ownPosts">>();
    for (const p of [...top, ...recent]) pick.set(p._id, p);
    const views = posts.map((p) => p.metrics.views).filter((x) => x > 0).sort((x, y) => x - y);
    const normal = views.length ? views[Math.floor(views.length / 2)] : null;
    const preds = (await ctx.db.query("predictions").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"predictions">[];
    return {
      posts: Array.from(pick.values()).map((p) => ({ url: p.url, views: p.metrics.views, multiple: p.multiple ?? null, caption: (p.caption ?? "").slice(0, 120), createTime: p.createTime })),
      normal,
      predictions: preds.map((p) => ({ confidence: p.confidence, outcome: p.outcomeMultiple ?? null })),
    };
  },
});

export const ownPostByUrl = internalQuery({
  args: { creatorId: v.id("creators"), postId: v.string() },
  handler: async (ctx, a): Promise<{ id: Id<"ownPosts">; url: string; views: number; multiple: number | null; metricsAsOf: number; createTime: number; caption: string } | null> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(200)) as Doc<"ownPosts">[];
    const p = posts.find((x) => x.postId === a.postId || x.url.includes(a.postId));
    return p ? { id: p._id, url: p.url, views: p.metrics.views, multiple: p.multiple ?? null, metricsAsOf: p.metricsAsOf, createTime: p.createTime, caption: (p.caption ?? "").slice(0, 200) } : null;
  },
});

export const writePrediction = internalMutation({
  args: { creatorId: v.id("creators"), subject: v.object({ ownPostId: v.optional(v.id("ownPosts")), draftFileId: v.optional(v.id("_storage")), url: v.optional(v.string()) }), confidence: v.union(v.literal("strong"), v.literal("solid"), v.literal("fine"), v.literal("weak"), v.literal("broken")), opinion: v.any(), produced: v.object({ skillVersion: v.string(), model: v.string(), thresholdsVersion: v.string() }) },
  handler: async (ctx, a): Promise<Id<"predictions">> =>
    await ctx.db.insert("predictions", { creatorId: a.creatorId, subject: a.subject, confidence: a.confidence, expectedMultiple: CONFIDENCE_MULTIPLE[a.confidence] ?? 1, opinion: a.opinion, produced: a.produced, createdAt: Date.now() }),
});

async function watchBytes(ctx: Parameters<typeof callModel>[0], creatorId: Id<"creators">, purpose: string, bytes: ArrayBuffer, mimeType: string, prompt: string): Promise<{ text: string | null; reason?: string }> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
  const model = WATCH_MODEL_TOP; // one draft at a time deserves the top model (§3.3 escalation)
  const r = await watchMedia({ model, apiKey, prompt, media: { bytes, mimeType }, resolution: "default", maxOutputTokens: 900 });
  if (r.usage) await ctx.runMutation(internal.core.costs.record, { creatorId, vendor: "gemini", resource: model, purpose, costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
  return r.ok ? { text: r.text } : { text: null, reason: r.reason };
}

function parseJson<T>(text: string): T | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}

/** The whole path for a link or a file: evidence → the read → the row → the message. */
export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), mode: v.union(v.literal("link"), v.literal("own"), v.literal("video"), v.literal("image"), v.literal("audio")), link: v.optional(v.object({ platform: v.union(v.literal("tiktok"), v.literal("instagram")), url: v.string(), handle: v.union(v.string(), v.null()), postId: v.union(v.string(), v.null()) })) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; transcript?: string }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g || !g.target) return { ok: false, reason: "message not found" };
    const { creator, directives, target } = g;
    const reply = async (body: string, extra: { produced?: ReturnType<typeof producedStamp>; criticSkipped?: boolean } = {}) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `opinion:${a.messageId}`, proactive: false, kind: a.mode === "own" ? "explain" : "opinion", ...extra });
      await deliverNow(ctx as never);
    };

    // ── evidence ──────────────────────────────────────────────────────────
    let card: Card | null = null;
    let transcript: string | null = null;
    let subject: { ownPostId?: Id<"ownPosts">; draftFileId?: Id<"_storage">; url?: string } = {};
    let cannotWatch: string | null = null;
    let own: OwnPost | null = null;

    if (a.mode === "audio") {
      const file = target.fileId ? await ctx.storage.get(target.fileId) : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      const t = await watchBytes(ctx, creator._id, "voice_transcribe", await file.arrayBuffer(), target.fileMime ?? "audio/ogg", TRANSCRIBE_PROMPT);
      if (!t.text) {
        await reply("couldn't make out the voice note. type it?");
        return { ok: true, reason: `voice: ${t.reason}` };
      }
      await ctx.runMutation(internal.agent.opinion.setBody, { messageId: a.messageId, body: `(voice) ${t.text.trim().slice(0, 2000)}` });
      return { ok: true, transcript: t.text.trim() };
    }

    if (a.mode === "image") {
      const file = target.fileId ? await ctx.storage.get(target.fileId) : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      const r = await watchBytes(ctx, creator._id, "read_screenshot", await file.arrayBuffer(), target.fileMime ?? "image/jpeg", SCREENSHOT_PROMPT);
      const read = r.text ? parseJson<{ kind: string; platform: string; numbers: Array<{ label: string; value: string }>; postTitleOrCaption: string; period: string }>(r.text) : null;
      if (!read || !read.numbers?.length) {
        await reply("i can see it's a screenshot but can't read numbers off it. what am i looking at?");
        return { ok: true, reason: "screenshot: no numbers read" };
      }
      // The numbers are evidence for a converse turn, in the message body, so they are a row.
      await ctx.runMutation(internal.agent.opinion.setBody, { messageId: a.messageId, body: `(screenshot: ${read.kind} on ${read.platform}${read.period ? `, ${read.period}` : ""}) ${read.numbers.map((n) => `${n.label}: ${n.value}`).join("; ")}${read.postTitleOrCaption ? ` — "${read.postTitleOrCaption}"` : ""}` });
      return { ok: true, transcript: "screenshot read" };
    }

    if (a.mode === "video") {
      const file = target.fileId ? await ctx.storage.get(target.fileId) : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      subject = { draftFileId: target.fileId ?? undefined };
      const w = await watchBytes(ctx, creator._id, "watch_draft", await file.arrayBuffer(), target.fileMime ?? "video/mp4", WATCH_PROMPT);
      card = w.text ? parseJson<Card>(w.text) : null;
      if (!card) cannotWatch = w.reason ?? "the watch failed";
    } else {
      const link = a.link!;
      subject = { url: link.url };
      if (a.mode === "own" && link.postId) {
        own = await ctx.runQuery(internal.agent.opinion.ownPostByUrl, { creatorId: creator._id, postId: link.postId });
        if (own) subject.ownPostId = own.id;
      }
      try {
        const info = await ctx.runAction(internal.reads.read.read, { kind: "post.info", params: { platform: link.platform, url: link.url }, creatorId: creator._id });
        const value = info.value as { videoUrl?: string | null; caption?: string; stats?: unknown } | null;
        if (value?.videoUrl) {
          const media = await fetchMedia(value.videoUrl);
          if (media.ok) {
            const w = await watchBytes(ctx, creator._id, "watch_link", media.bytes, media.mimeType, WATCH_PROMPT);
            card = w.text ? parseJson<Card>(w.text) : null;
            if (card && value.caption) card.caption = value.caption;
            if (card && value.stats) card.stats = value.stats;
          } else cannotWatch = media.reason;
        } else cannotWatch = "no playable url";
      } catch (e) {
        cannotWatch = e instanceof Error ? e.message.slice(0, 80) : "read failed";
      }
      try {
        const t = await ctx.runAction(internal.reads.read.read, { kind: "post.transcript", params: { platform: link.platform, url: link.url }, creatorId: creator._id });
        transcript = ((t.value as { transcript?: string | null } | null)?.transcript ?? null)?.slice(0, 1500) ?? null;
      } catch {
        transcript = null;
      }
    }

    if (!card && !transcript && !own) {
      await reply(a.mode === "video" ? `couldn't watch that one (${cannotWatch ?? "the file didn't open"}). try a smaller export, under 20 MB, or a link once it's up.` : `couldn't open that link (${cannotWatch ?? "nothing came back"}). if it's private or a draft, send the file instead.`);
      return { ok: true, reason: `no evidence: ${cannotWatch ?? "none"}` };
    }

    // ── the read ─────────────────────────────────────────────────────────
    const history = await ctx.runQuery(internal.agent.opinion.ownHistory, { creatorId: creator._id });
    const skill = a.mode === "own" ? EXPLAIN_POST_SKILL : OPINION_SKILL;
    const prefix = buildPrefix({ creator, directives, skill });
    const spec = REGISTRY.writer;
    const evidence = {
      what: a.mode === "own" ? "their own post" : a.mode === "video" ? "a draft they sent as a file" : "a link they sent",
      theirWords: target.body.slice(0, 400),
      card: card ?? (cannotWatch ? { unavailable: cannotWatch } : null),
      transcript,
      ownPost: own ? { ...own, hoursOld: Math.round((Date.now() - own.createTime) / 3_600_000), metricsHoursOld: Math.round((Date.now() - own.metricsAsOf) / 3_600_000) } : null,
      theirHistory: history,
    };
    const user = `Evidence (everything you may cite is here; nothing else):\n${JSON.stringify(evidence)}`;
    const ask = async (purpose: string, extra = "") => callModel(ctx, { creatorId: creator._id, purpose, model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: user + extra }], temperature: 0.4, maxTokens: 1600, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    type Out = { message: string; biggest: string; second: string; fine: string; confidence: string; citations: Array<{ stat: string; value: string | number; sampleSize?: number }>; cannotKnow: string };
    let r = await ask("opinion");
    let out = r.ok ? parseJson<Out>(r.content) : null;
    if (!out || !Array.isArray(out.citations) || out.citations.length === 0 || !out.message?.trim()) {
      r = await ask("opinion_retry", "\n\nYour previous answer had no citation or no message. Cite at least one number from the evidence, and output the JSON only.");
      out = r.ok ? parseJson<Out>(r.content) : null;
    }
    if (!out || !out.citations?.length || !out.message?.trim()) {
      await reply("i watched it but i can't give you a read i'd stand behind right now. give me an hour and send it again?");
      return { ok: true, reason: `no grounded opinion: ${r.ok ? `raw=${r.content.slice(0, 300).replace(/\s+/g, " ")}` : r.reason}` };
    }
    const confidence = (["strong", "solid", "fine", "weak", "broken"] as const).includes(out.confidence as never) ? (out.confidence as "strong" | "solid" | "fine" | "weak" | "broken") : "fine";
    const produced = producedStamp(spec.primary);

    // ── the critic, one rewrite ──────────────────────────────────────────
    const dossierVoice = creator.dossier as { voice?: unknown; persona?: unknown } | undefined;
    let text = out.message.trim();
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "opinion", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
    let criticSkipped = Boolean(verdict.skipped);
    if (!verdict.pass) {
      const rw = await ask("opinion_rewrite", `\n\nYour previous message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite ONLY the message text, fixing exactly that; keep the same confidence word. Output the message text only.`);
      if (rw.ok && rw.content.trim()) {
        text = rw.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over" } : await critique(ctx, { creatorId: creator._id, kind: "opinion", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
        criticSkipped = criticSkipped || Boolean(verdict.skipped);
      }
      if (!verdict.pass) {
        await reply("i have a read on it but it didn't pass my own check. ask me again in a bit and i'll do it properly.");
        return { ok: true, reason: `critic: ${verdict.problems.join(", ")}` };
      }
    }

    const predictionId = a.mode === "own" && !own ? null : await ctx.runMutation(internal.agent.opinion.writePrediction, { creatorId: creator._id, subject, confidence, opinion: { biggest: out.biggest, second: out.second, fine: out.fine, citations: out.citations, cannotKnow: out.cannotKnow, mode: a.mode }, produced });
    await reply(text, { produced, criticSkipped });
    return { ok: true, reason: predictionId ? `prediction ${predictionId}` : "explained" };
  },
});

export const setBody = internalMutation({
  args: { messageId: v.id("messages"), body: v.string() },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.messageId, { body: a.body });
    return null;
  },
});

export type LinkArg = ParsedLink;
