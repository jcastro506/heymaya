/**
 * The opinion skill (plan §11.2 #10, §14.6, §13.6) and its cousins: a link to someone
 * else's post, a draft file, a link to their own post (`explain-post`, #9), an
 * analytics screenshot (`read-screenshot`, #12) and a voice note. Evidence is
 * gathered by code, watched by Gemini, and the writer gives one grounded read with a
 * confidence in words and a `predictions` row, so the track record is a table, not
 * a feeling. An opinion with zero citations is not sent.
 */

import { v } from "convex/values";
import { normalViews } from "../core/normal";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY, WATCH_MODEL, WATCH_MODEL_TOP } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique, tooLong } from "./critic";
import { CAUTIOUS_ASK, judgeLadder, ownPostFloor } from "./guarded";
import { buildEvidencePack, supportedHypotheses, type EvidencePack } from "../core/evidencePack";
import { deliverNow } from "../core/scheduler";
import { fetchMedia, INLINE_MAX_BYTES, watchMedia } from "../integrations/gemini/client";
import { faultFetch, faultFor } from "../eval/faults";
import { WATCH_PROMPT } from "../onboarding/watch";
import type { ParsedLink } from "./inbound";
import { investigate } from "./investigate";
import { LOOKUPS } from "./playbooks";
import { clip } from "../lib/clip";

export const CONFIDENCE_MULTIPLE: Record<string, number> = { strong: 1.8, solid: 1.3, fine: 1.0, weak: 0.7, broken: 0.4 }; // §13.6 (tune)

export const OPINION_SKILL = `opinion
When: they sent a draft, a link, or asked "will this go viral". You are giving a read, not a verdict, and you never promise a number.
The judgment: what the video does in its first three seconds against what has worked for THEM (their own top posts, the dossier) and what you know of their lane; their own history with this structure; the three highest-leverage fixes in order; a confidence in one word from strong | solid | fine | weak | broken, calibrated to their own baseline (fine = about their normal); and what you cannot know: the evidence's numbers.cannotKnow says what THIS platform hides (TikTok hides watch time and retention from everyone; an Instagram Reel with a connected account shows them, and then you cite them with their basis). Never guess a hidden number.
Tone: the same as always. If the card says one thing and their caption implies another (an ironic caption on a straight video is a bit, not a mistake), read it as the bit. A draft with a copyrighted sound: "fine if it's in the app's library".
Cite: at least one number you were actually given (their multiple on a comparable post, a stat from the card, their normal). No number you weren't given.
Output ONLY JSON:
{"message": "≤700 chars, in your voice: your reaction as a viewer first (one line, the moment that got you or lost you, named from the card or their words, never a detail you were not given), then the read, then the three fixes, then the confidence word in a sentence, no bullets", "biggest": "≤200", "second": "≤200", "fine": "≤120 what already works", "confidence": "strong|solid|fine|weak|broken", "citations": [{"stat": "", "value": "", "sampleSize": 0}], "cannotKnow": "≤160"}` + LOOKUPS.opinion;

export const EXPLAIN_POST_SKILL = `explain-post
When: they sent a link to their OWN post and want to know why it did what it did, up or down. You are their expert: find the likely cause, don't just report the number.
You have an evidence pack: the post against their own recent posts (when and how long, caption, hashtags new to them, sound reuse, format, engagement per 100 views against their usual, the shape of how the views arrived, and when they cross-posted it, the same video on their other platform) plus whatever your lookups return. A video that broke out on both platforms is about the video; one that only broke out on one is about that platform, that day, or who saw it first. Each pack entry has a key.
The judgment: rank up to three causes, most likely first. Each cause cites the pack keys or lookups that support it; a cause you can't point at evidence for is not a cause, leave it out. Things only they know (a paid boost, a friend with a big account sharing it, a cross-post, a location or event) you ask about rather than guess.
Asking: when your top two causes can't be told apart from the evidence, or the likely cause is something only they'd know, end with ONE question that names them ("was this the night of the concert, or did someone big share it?"). Otherwise don't ask.
After a hit (well above their normal): the one thing to do in the next day or two while the audience is warm, tied to THIS post (the part two people are asking for, a reply to the top comment, the same format again).
Under 48 hours old the numbers aren't done moving: say what it's at so far and when you'll know.
What you can't see, you don't state: TikTok shows nobody watch time, loops or retention, so a short length makes looping LIKELY ("at 5 seconds it probably looped"), never a fact ("it looped before anyone scrolled") and never near-certain ("it almost certainly looped"): "probably" is as far as you can go. On Instagram, retention exists only in numbers you were given.
On a public view count you cannot tell "the platform didn't show it" from "people scrolled past it": never say TikTok or Instagram "didn't push it", "buried it" or "pushed it to everyone" unless you were given reach. Say what the number is and what's likely, with what points to it.
Message: short, in your voice, the moment or the number first, then the likely cause with what points to it, then the one thing to do or the one question. Never a metric you weren't given.
Output ONLY JSON: {"message": "≤600 chars", "hypotheses": [{"cause": "≤160", "evidence": ["pack key or lookup name"], "confidence": "likely|possible"}], "question": "≤160 or ''", "biggest": "≤200", "second": "≤200", "fine": "≤120", "confidence": "strong|solid|fine|weak|broken", "citations": [{"stat": "", "value": "", "sampleSize": 0}], "cannotKnow": "≤160"}` + LOOKUPS.explainPost;

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
    // The one definition (core/normal.ts): settled posts, their main platform.
    const counts = new Map<string, number>();
    for (const p of posts) counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1);
    const main = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const normal = main ? normalViews(posts, main, Date.now())?.value ?? null : null;
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

/** The B2 evidence pack for one of their posts, against their own recent posts. */
export const packFor = internalQuery({
  args: { creatorId: v.id("creators"), ownPostId: v.id("ownPosts") },
  handler: async (ctx, a): Promise<EvidencePack | null> => {
    const post = (await ctx.db.get(a.ownPostId)) as Doc<"ownPosts"> | null;
    const creator = await ctx.db.get(a.creatorId);
    if (!post || !creator || post.creatorId !== a.creatorId) return null;
    const others = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPosts">[];
    return buildEvidencePack(post, others.filter((o) => o._id !== post._id), creator.timezone ?? "UTC", Date.now());
  },
});

/** The same pack by platform post id, for a win signal (scout), scoped to the creator. */
export const packForPostId = internalQuery({
  args: { creatorId: v.id("creators"), postId: v.string() },
  handler: async (ctx, a): Promise<EvidencePack | null> => {
    const creator = await ctx.db.get(a.creatorId);
    if (!creator) return null;
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(80)) as Doc<"ownPosts">[];
    // By id OR by the id in its URL: Instagram rows store a numeric id, links carry the /p/ code.
    const post = rows.find((r) => r.postId === a.postId || r.url.includes(`/${a.postId}`));
    return post ? buildEvidencePack(post, rows.filter((o) => o._id !== post._id), creator.timezone, Date.now()) : null;
  },
});

export const writePrediction = internalMutation({
  args: { creatorId: v.id("creators"), subject: v.object({ ownPostId: v.optional(v.id("ownPosts")), draftFileId: v.optional(v.id("_storage")), url: v.optional(v.string()) }), confidence: v.union(v.literal("strong"), v.literal("solid"), v.literal("fine"), v.literal("weak"), v.literal("broken")), opinion: v.any(), produced: v.object({ skillVersion: v.string(), model: v.string(), thresholdsVersion: v.string() }) },
  handler: async (ctx, a): Promise<Id<"predictions">> =>
    await ctx.db.insert("predictions", { creatorId: a.creatorId, subject: a.subject, confidence: a.confidence, expectedMultiple: CONFIDENCE_MULTIPLE[a.confidence] ?? 1, opinion: a.opinion, produced: a.produced, createdAt: Date.now() }),
});

/**
 * Pure: was this failure on OUR side (a vendor out of credits, rate limited, down, overloaded or
 * slow) rather than about their link or file? Found by the outage drill (2026-09-24): an
 * out-of-credits read told a creator `couldn't open that link (read(post.info) failed:
 * ScrapeCreators HTTP 402 for https://api.scrapecr…). if it's private or a draft, send the file
 * instead.` That blamed their link for our bill, and put vendor plumbing in a text.
 */
export function isOurSide(detail: string | null | undefined): boolean {
  return /\b(402|429|5\d\d)\b|out of credits|rate limit|timed out|timeout|overloaded|high demand|unavailable|unreachable|try again later|resource.?exhausted|in-flight wait/i.test(detail ?? "");
}
export const LINK_OUR_SIDE = "couldn't pull that post up just now. that's on my side, not your link. send it again in a bit and i'll take another look.";
export const LINK_UNOPENABLE = "couldn't open that link. if it's private or a draft, send me the file instead.";
export const WATCH_OUR_SIDE = "couldn't watch that one just now. that's on my side, not your video. send it again in a few minutes?";
/** The writer was down (the model call failed), not "a read i'd stand behind": said as ours, and never "i watched it" when she didn't. */
export const READ_WRITER_DOWN = "couldn't put a read together just now. that's on my side, not the post. send it again in a bit?";

/** Pure: a failure that another model would likely not have (capacity), not one about the file. */
export function isOverloaded(reason: string | undefined): boolean {
  return /high demand|overloaded|unavailable|try again later|resource.?exhausted|timed? ?out|timeout|\b(429|503|504)\b/i.test(reason ?? "");
}

/** A stored file, ready to watch: inline bytes when small, an uploaded file reference when big (a phone video). */
export async function storedMedia(ctx: Parameters<typeof callModel>[0], storageId: Id<"_storage">, mimeType: string): Promise<ArrayBuffer | { fileUri: string } | null> {
  const c = ctx as unknown as { runQuery: (f: unknown, a: unknown) => Promise<number | null>; runAction: (f: unknown, a: unknown) => Promise<{ ok: boolean; uri?: string }>; storage: { get: (id: Id<"_storage">) => Promise<Blob | null> } };
  const size = await c.runQuery(internal.agent.opinion.storedSize, { storageId });
  if (size === null) return null;
  if (size <= INLINE_MAX_BYTES) { const blob = await c.storage.get(storageId); return blob ? await blob.arrayBuffer() : null; }
  const up = await c.runAction(internal.core.bigMedia.uploadStoredForWatch, { storageId, mimeType });
  return up.ok && up.uri ? { fileUri: up.uri } : null;
}

export const storedSize = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, a): Promise<number | null> => ((await ctx.db.system.get(a.storageId)) as { size?: number } | null)?.size ?? null,
});

export async function watchBytes(ctx: Parameters<typeof callModel>[0], creatorId: Id<"creators">, purpose: string, bytes: ArrayBuffer | { fileUri: string }, mimeType: string, prompt: string, maxOutputTokens = 900): Promise<{ text: string | null; reason?: string }> {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
  // Outage drill (eval/faults.ts): Gemini failing for this eval creator, both models. Undefined in production.
  const fault = await faultFor(ctx, creatorId, "gemini", { purpose });
  const fetchImpl = fault ? faultFetch(fault) : undefined;
  // One draft at a time deserves the top model (§3.3 escalation); when it's overloaded, the everyday
  // watcher still sees and hears the video (living sim: ~1 in 5 drafts failed on "high demand").
  let r = await watchMedia({ model: WATCH_MODEL_TOP, apiKey, prompt, media: bytes instanceof ArrayBuffer ? { bytes, mimeType } : { fileUri: bytes.fileUri, mimeType }, resolution: "default", maxOutputTokens, fetchImpl });
  let model = WATCH_MODEL_TOP;
  if (!r.ok && isOverloaded(r.reason)) {
    model = WATCH_MODEL;
    r = await watchMedia({ model, apiKey, prompt, media: bytes instanceof ArrayBuffer ? { bytes, mimeType } : { fileUri: bytes.fileUri, mimeType }, resolution: "default", maxOutputTokens, fetchImpl });
  }
  if (r.usage) await ctx.runMutation(internal.core.costs.record, { creatorId, vendor: "gemini", resource: model, purpose, costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
  return r.ok ? { text: r.text } : { text: null, reason: r.reason };
}

export function parseJson<T>(text: string): T | null {
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
      const file = target.fileId ? await storedMedia(ctx, target.fileId, target.fileMime ?? "application/octet-stream") : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      const t = await watchBytes(ctx, creator._id, "voice_transcribe", file, target.fileMime ?? "audio/ogg", TRANSCRIBE_PROMPT);
      if (!t.text) {
        await reply("couldn't make out the voice note. type it?");
        return { ok: true, reason: `voice: ${t.reason}` };
      }
      await ctx.runMutation(internal.agent.opinion.setBody, { messageId: a.messageId, body: `(voice) ${t.text.trim().slice(0, 2000)}` });
      return { ok: true, transcript: t.text.trim() };
    }

    if (a.mode === "image") {
      const file = target.fileId ? await storedMedia(ctx, target.fileId, target.fileMime ?? "application/octet-stream") : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      const r = await watchBytes(ctx, creator._id, "read_screenshot", file, target.fileMime ?? "image/jpeg", SCREENSHOT_PROMPT);
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
      const file = target.fileId ? await storedMedia(ctx, target.fileId, target.fileMime ?? "application/octet-stream") : null;
      if (!file) return { ok: false, reason: "no file bytes" };
      await ctx.runAction(internal.core.telegram.react, { creatorId: creator._id, messageId: target._id, emoji: "👀" }).catch(() => undefined); // §21.5: she's looking
      subject = { draftFileId: target.fileId ?? undefined };
      const w = await watchBytes(ctx, creator._id, "watch_draft", file, target.fileMime ?? "video/mp4", WATCH_PROMPT);
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
            // Said in the evidence (`card: {unavailable}`), so a read from the transcript never sounds like she watched it.
            if (!card) cannotWatch = w.reason ?? "the watch failed";
            if (card && value.caption) card.caption = value.caption;
            if (card && value.stats) card.stats = value.stats;
          } else cannotWatch = media.reason;
        } else cannotWatch = "no playable url";
      } catch (e) {
        cannotWatch = e instanceof Error ? clip(e.message, 80) : "read failed";
      }
      try {
        const t = await ctx.runAction(internal.reads.read.read, { kind: "post.transcript", params: { platform: link.platform, url: link.url }, creatorId: creator._id });
        transcript = ((t.value as { transcript?: string | null } | null)?.transcript ?? null)?.slice(0, 1500) ?? null;
      } catch {
        transcript = null;
      }
    }

    if (!card && !transcript && !own) {
      await reply(a.mode === "video" ? (isOurSide(cannotWatch) ? WATCH_OUR_SIDE : `couldn't watch that one (${cannotWatch ?? "the file didn't open"}). try a smaller export, under 20 MB, or a link once it's up.`) : isOurSide(cannotWatch) ? LINK_OUR_SIDE : LINK_UNOPENABLE);
      return { ok: true, reason: `no evidence: ${cannotWatch ?? "none"}` };
    }

    // ── the read ─────────────────────────────────────────────────────────
    const history = await ctx.runQuery(internal.agent.opinion.ownHistory, { creatorId: creator._id });
    const skill = a.mode === "own" ? EXPLAIN_POST_SKILL : OPINION_SKILL;
    const prefix = buildPrefix({ creator, directives, skill, personal: g.personal, voice: g.voice, history: g.history });
    const spec = REGISTRY.writer;
    const pack = own ? await ctx.runQuery(internal.agent.opinion.packFor, { creatorId: creator._id, ownPostId: own.id }) : null;
    const evidence = {
      what: a.mode === "own" ? "their own post" : a.mode === "video" ? "a draft they sent as a file" : "a link they sent",
      theirWords: clip(target.body, 400),
      card: card ?? (cannotWatch ? { unavailable: cannotWatch } : null),
      transcript,
      // Sprint 4e: the labelled numbers and the four-way read, or what the platform hides.
      ownPost: own ? { ...own, hoursOld: Math.round((Date.now() - own.createTime) / 3_600_000), metricsHoursOld: Math.round((Date.now() - own.metricsAsOf) / 3_600_000), numbers: await ctx.runQuery(internal.connections.numbers.forPost, { ownPostId: own.id }) } : null,
      theirHistory: history,
      ...(pack ? { pack: pack.facts } : {}),
    };
    const user = `Evidence (everything you may cite is here; nothing else):\n${JSON.stringify(evidence)}`;
    const ask = async (purpose: string, extra = "") => callModel(ctx, { creatorId: creator._id, purpose, model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: user + extra }], temperature: 0.4, maxTokens: 1600, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    type Out = { message: string; hypotheses?: unknown; question?: string; biggest: string; second: string; fine: string; confidence: string; citations: Array<{ stat: string; value: string | number; sampleSize?: number }>; cannotKnow: string };
    // §13.11: for a link she may look up the sound, the comments and the author's normal before the read.
    let r: { ok: boolean; content: string; reason?: string };
    let investigation: Array<{ tool: string; params: Record<string, unknown>; why: string; credits?: number; ms: number; ok: boolean }> = [];
    if (a.mode === "link" || a.mode === "own") {
      const inv = await investigate(ctx, { creatorId: creator._id, purpose: a.mode === "own" ? "explain_post" : "opinion", prefix, user, budget: { calls: a.mode === "own" ? 3 : 4, credits: 20, deadlineAt: Date.now() + 45_000 }, temperature: 0.4, maxTokens: 1600 });
      investigation = inv.trace;
      r = inv.content ? { ok: true, content: inv.content } : { ok: false, content: "", reason: inv.ended };
    } else {
      const first = await ask("opinion");
      r = first.ok ? { ok: true, content: first.content } : { ok: false, content: "", reason: first.reason };
    }
    let out = r.ok ? parseJson<Out>(r.content) : null;
    // B2: a cause survives only if it cites a pack key or a lookup that actually ran.
    const citable = [...(pack?.keys ?? []), ...investigation.filter((t) => t.ok).map((t) => t.tool), "card", "transcript", "theirWords", "ownPost", "theirHistory"];
    const causesOk = (o: Out | null) => a.mode !== "own" || supportedHypotheses(o?.hypotheses, citable).length > 0 || Boolean(o?.question?.trim());
    if (!out || !Array.isArray(out.citations) || out.citations.length === 0 || !out.message?.trim() || !causesOk(out)) {
      const retry = await ask("opinion_retry", "\n\nYour previous answer had no citation, no message, or no cause backed by evidence. Cite at least one number from the evidence; every cause must list pack keys or lookups that support it, and if none can, ask them the one question instead. Output the JSON only.");
      r = retry.ok ? { ok: true, content: retry.content } : { ok: false, content: "", reason: retry.reason };
      out = r.ok ? parseJson<Out>(r.content) : null;
    }
    if (!out || !out.citations?.length || !out.message?.trim()) {
      await reply(!r.ok ? READ_WRITER_DOWN : `${card ? "i watched it" : "i looked at it"} but i can't give you a read i'd stand behind right now. give me an hour and send it again?`);
      return { ok: true, reason: `no grounded opinion: ${r.ok ? `raw=${clip(r.content, 300).replace(/\s+/g, " ")}` : r.reason}` };
    }
    const confidence = (["strong", "solid", "fine", "weak", "broken"] as const).includes(out.confidence as never) ? (out.confidence as "strong" | "solid" | "fine" | "weak" | "broken") : "fine";
    const produced = producedStamp(spec.primary);

    // ── the critic ladder: read → rewrite → cautious → floor; never silent (B2) ──
    const dossierVoice = creator.dossier as { voice?: unknown; persona?: unknown } | undefined;
    const causes = a.mode === "own" ? supportedHypotheses(out.hypotheses, citable) : [];
    const judgedEvidence = causes.length ? { ...evidence, causesWithEvidence: causes } : evidence;
    const judge = async (text: string) => (tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: a.mode === "own" ? "explain" : "opinion", text, evidence: judgedEvidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim), causesEvidenced: causes.length > 0 }));
    const plain = async (purpose: string, extra: string) => {
      const rw = await ask(purpose, extra);
      return rw.ok && rw.content.trim() ? rw.content.trim() : null;
    };
    const judged = await judgeLadder({
      first: out.message,
      judge,
      rewrite: (v) => plain("opinion_rewrite", `\n\nYour previous message was rejected by the critic for: ${v.problems.join(", ")} (${v.note}). Rewrite ONLY the message text, fixing exactly that; keep the same confidence word. Output the message text only, no JSON.\n\nPrevious message:\n${out!.message}`),
      cautious: (v) => plain("opinion_cautious", CAUTIOUS_ASK(v.problems, v.note)),
      floor: ownPostFloor(own ? { views: own.views, multiple: own.multiple, hoursOld: Math.round((Date.now() - own.createTime) / 3_600_000) } : null),
    });
    const text = judged.text;
    const criticSkipped = judged.criticSkipped;

    const predictionId = (a.mode === "own" && !own) || judged.rung === "floor" ? null : await ctx.runMutation(internal.agent.opinion.writePrediction, { creatorId: creator._id, subject, confidence, opinion: { biggest: out.biggest, second: out.second, fine: out.fine, citations: out.citations, cannotKnow: out.cannotKnow, mode: a.mode, investigation, hypotheses: causes, question: out.question ?? "", rung: judged.rung, watched: card ? Object.fromEntries(Object.entries(card).filter(([k]) => k !== "stats").map(([k, val]) => [k, typeof val === "string" ? val.slice(0, 300) : val])) : null }, produced });
    // The floor has no model in it, so it carries no produced stamp and makes no prediction claim.
    await reply(text, judged.rung === "floor" ? { criticSkipped } : { produced, criticSkipped });
    return { ok: true, reason: `${judged.rung}${judged.problems.length ? ` (${judged.problems.join(",")})` : ""}; ${predictionId ? `prediction ${predictionId}` : "explained"}; causes ${causes.length}` };
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
