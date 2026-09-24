/**
 * B7 "finish this one": they filmed it and they're stuck on the caption and the sound.
 *
 * She watches AND listens to the draft (one Gemini pass), code gathers the sound candidates
 * (sounds the accounts they watch used this week, sounds on their own past posts, their lane's
 * rising sounds), she looks up what she needs (sound_info, sound_videos, suggestions), and she
 * writes three captions in THEIR voice and one to three sounds with a reason tied to this video.
 *
 * Code keeps the promises:
 * - a named sound survives only if a lookup this turn returned it (or it's "your own audio");
 *   anything else is dropped and recorded, never sent;
 * - her reasons are stored on a `finishes` row, so "why that one?" is answered from what she
 *   thought then (`finish_notes`), never a reason invented after the fact;
 * - when they post, `learnFromPosted` compares what went out with what she offered and keeps
 *   one caption habit as a preference, so the next captions sound more like them.
 */
import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { critique } from "./critic";
import { deliverNow } from "../core/scheduler";
import { investigate } from "./investigate";
import { parseJson, watchBytes } from "./opinion";
import type { ToolCallRecord } from "./tools";

const WEEK_MS = 7 * 86_400_000;

export const FINISH_WATCH_PROMPT = `You are watching AND listening to one short video a creator filmed and hasn't posted yet. They need a caption and a sound for it. Observations only. Return STRICT JSON, no prose:
{
 "about": "≤220: what happens in it and what it's about, concretely (the dish, the place, the bit)",
 "spokenWords": "≤500: what is said, close to verbatim, or ''",
 "onScreenText": "≤200: every piece of text shown, or ''",
 "audioNow": "original-voice|voice-over|music|voice-over-music|ambient|silent",
 "audioDescription": "≤200: what you hear: their voice (pace, tone), any music (genre, energy, tempo), sound moments that matter (a sizzle, a laugh, a door)",
 "voiceCarriesIt": true,
 "beatDriven": false,
 "mood": "≤60",
 "energy": "calm|medium|high",
 "pacing": {"cutsPerTenSeconds": 0, "lengthSec": 0},
 "hook": "≤160: the first two seconds",
 "payoff": "≤160 or ''",
 "aFriendWouldNotice": "≤200: the one thing a friend would say about it"
}
voiceCarriesIt: true when the words are the point and music must stay under them. beatDriven: true when the cuts land on a rhythm or would suit one.`;

export const FINISH_SKILL = `finish
When: they sent a video they filmed and haven't posted, and they need the caption and the sound. That is the job: finish it with them. Only if their words ask what you think of it (or whether it'll do well) do you also give a read, two lines, the one fix that matters most.
You have: the card (what you saw and heard in the draft), their own captions and habits (the voice block in your prefix: length, case, emoji, hashtags, their best lines), their past posts' sounds, and sounds the accounts they watch used this week.

Captions: write three, and make them three DIFFERENT kinds, never three rewordings:
- "their-usual": the shape of their own best captions (same length, case, emoji and hashtag habits), about THIS video;
- "question": a line that gets the comments talking, in their voice, about something in this video people will have an opinion on;
- "search": for TikTok, one or two words people actually search for this (use suggestions or search_keyword if you're not sure), worked in the way they'd write it; for Instagram, the line that makes someone save or send it, only if that fits how they write.
Every caption uses a concrete thing from THIS video (the card's about, spokenWords, onScreenText, payoff). It must read like they wrote it: if they write lowercase with no emoji, so do you. Never: explaining the joke, an abstract noun (journey, mindset, era, discipline, vibes), a borrowed format (pov:, nobody:, tell me why, it's giving, the way I), hashtag stuffing, anything cheesy you'd see on a stock video. A caption can be short. Short and theirs beats clever and generic.

Sounds: one to three, each with why it fits THIS video (the mood, the pace, the words) in a few words, and how to use it ("low under your voice", "start it on the first cut").
- Look the sound up before you name it: sound_info gives its name, how many videos use it, and whether it's cleared for business accounts; sound_videos shows whether people are using it now. A sound you did not look up this turn is not named; code removes it.
- Prefer a sound the accounts they watch are using this week, or one on their own posts that did well, when it fits the video. A sound that doesn't fit the mood is wrong even if it's big.
- When voiceCarriesIt, their own audio is usually right, or a quiet music bed under it; say so plainly.
- If a sound is NOT cleared for business accounts, say: fine on a personal account, but not on a business account or a paid post.
- Instagram: you can't always check Instagram audio. Name the track to search in Reels audio and say to check it's there.

Their words on the draft may say the platform ("for insta"); write for that platform. Otherwise, for where they post.
Output ONLY JSON:
{"reaction": "≤200: one line as a viewer, the moment that got you, named from the card", "read": "≤240 or ''", "captions": [{"text": "≤300, exactly as they'd paste it", "shape": "their-usual|question|search", "why": "≤160: why this one, for them (kept for when they ask)"}], "sounds": [{"name": "≤80: 'title by author', or 'your own audio'", "clipId": "the TikTok clip id you looked up, or ''", "platform": "tiktok|instagram|both", "source": "their-own-audio|watched-accounts|their-past-post|trending", "why": "≤120", "howToUse": "≤100"}], "platformNote": "≤160 or ''"}`;

export interface SoundCandidates {
  watchedThisWeek: Array<{ clipId: string; accounts: string[]; posts: number; topUrl: string; topViews: number }>;
  theirPast: Array<{ clipId: string; posts: number; bestMultiple: number | null; exampleUrl: string }>;
  laneRising: Array<{ clipId: string; detected: string }>;
}

/** What code knows about sounds for them, before any lookup. Ids only: names come from sound_info. */
export async function readSoundCandidates(ctx: QueryCtx, creatorId: Id<"creators">, now: number): Promise<SoundCandidates> {
  const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).take(60)) as Doc<"trackedAccounts">[];
  const by = new Map<string, { clipId: string; accounts: Set<string>; posts: number; topUrl: string; topViews: number }>();
  for (const t of tracked.filter((x) => x.status === "active" && x.platform === "tiktok")) {
    const obs = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", "tiktok").eq("authorHandle", t.handle).gte("sampledAt", now - WEEK_MS)).take(40)) as Doc<"observations">[];
    for (const o of obs) {
      if (!o.clipId) continue;
      const cur = by.get(o.clipId) ?? { clipId: o.clipId, accounts: new Set<string>(), posts: 0, topUrl: o.url, topViews: 0 };
      cur.accounts.add(o.authorHandle);
      cur.posts++;
      if (o.views > cur.topViews) { cur.topViews = o.views; cur.topUrl = o.url; }
      by.set(o.clipId, cur);
    }
  }
  const watchedThisWeek = [...by.values()].sort((a, b) => b.accounts.size - a.accounts.size || b.topViews - a.topViews).slice(0, 8).map((s) => ({ clipId: s.clipId, accounts: [...s.accounts], posts: s.posts, topUrl: s.topUrl, topViews: s.topViews }));
  const own = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(120)) as Doc<"ownPosts">[];
  const mine = new Map<string, { clipId: string; posts: number; bestMultiple: number | null; exampleUrl: string }>();
  for (const p of own) {
    if (!p.soundClipId) continue;
    const cur = mine.get(p.soundClipId) ?? { clipId: p.soundClipId, posts: 0, bestMultiple: null, exampleUrl: p.url.split("?")[0] };
    cur.posts++;
    if (p.multiple !== undefined && p.multiple !== null && (cur.bestMultiple === null || p.multiple > cur.bestMultiple)) { cur.bestMultiple = p.multiple; cur.exampleUrl = p.url.split("?")[0]; }
    mine.set(p.soundClipId, cur);
  }
  const theirPast = [...mine.values()].sort((a, b) => (b.bestMultiple ?? 0) - (a.bestMultiple ?? 0)).slice(0, 6);
  const signals = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", now - WEEK_MS)).take(80)) as Doc<"signals">[];
  const laneRising = signals.filter((s) => s.kind === "sound" && s.clipId).slice(0, 5).map((s) => ({ clipId: s.clipId!, detected: (s.detected ?? "").slice(0, 200) }));
  return { watchedThisWeek, theirPast, laneRising };
}

export const soundCandidates = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<SoundCandidates> => await readSoundCandidates(ctx, a.creatorId, a.now),
});

type Out = { reaction: string; read?: string; captions: Array<{ text: string; shape: string; why: string }>; sounds: Array<{ name: string; clipId?: string; platform: string; source: string; why: string; howToUse: string }>; platformNote?: string };

/** Pure: a named sound survives only if a lookup this turn backs it, or it's their own audio. */
export function backedSounds(sounds: Out["sounds"], trace: Array<Pick<ToolCallRecord, "tool" | "ok" | "params" | "result">>): { kept: Array<Out["sounds"][number] & { licensedForBusiness?: boolean }>; dropped: string[] } {
  const kept: Array<Out["sounds"][number] & { licensedForBusiness?: boolean }> = [];
  const dropped: string[] = [];
  const looked = trace.filter((t) => t.ok && ["sound_info", "sound_videos", "sound_reels", "trending_tiktok", "trending_reels", "account_posts", "search_keyword"].includes(t.tool));
  for (const s of sounds.slice(0, 3)) {
    const name = (s.name ?? "").trim();
    if (!name) continue;
    if (/^(your|their) own (audio|voice)/i.test(name) || s.source === "their-own-audio") { kept.push({ ...s, clipId: undefined }); continue; }
    const id = (s.clipId ?? "").trim();
    const title = name.split(/ by /i)[0].replace(/^["“]|["”]$/g, "").trim().toLowerCase();
    const info = looked.find((t) => t.tool === "sound_info" && (String(t.params?.clipId ?? "") === id || (t.result ?? "").toLowerCase().includes(`"${title}"`)));
    const anyMention = looked.some((t) => (id && (String(t.params?.clipId ?? "") === id || (t.result ?? "").includes(id))) || (title.length > 2 && (t.result ?? "").toLowerCase().includes(title)));
    if (!info && !anyMention) { dropped.push(name); continue; }
    const r = info?.result ?? "";
    kept.push({ ...s, clipId: id || undefined, ...(r.includes("NOT cleared for business") ? { licensedForBusiness: false } : r.includes("business-safe library") ? { licensedForBusiness: true } : {}) });
  }
  return { kept, dropped };
}

/** Pure: the text she sends. Captions as they'd paste them; sounds with their few-word reason. */
export function finishText(o: { reaction: string; read?: string; captions: Out["captions"]; sounds: Array<Out["sounds"][number] & { licensedForBusiness?: boolean }>; platformNote?: string }): string {
  const parts: string[] = [];
  parts.push([o.reaction.trim(), (o.read ?? "").trim()].filter(Boolean).join(" "));
  parts.push(`captions:\n${o.captions.map((c, i) => `${i + 1}. ${c.text.trim()}`).join("\n")}`);
  const soundLines = o.sounds.map((s) => `${s.name.trim()}: ${s.why.trim()}${s.howToUse?.trim() ? `, ${s.howToUse.trim()}` : ""}${s.licensedForBusiness === false ? " (fine on a personal account, not on a business account or a paid post)" : ""}`);
  parts.push(`${soundLines.length > 1 ? "sounds" : "sound"}:\n${soundLines.join("\n")}${o.platformNote?.trim() ? `\n${o.platformNote.trim()}` : ""}\n\nask me why on any of them.`);
  return parts.join("\n---\n");
}

export const record = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), fileId: v.optional(v.id("_storage")), card: v.any(), captions: v.array(v.object({ text: v.string(), shape: v.string(), why: v.string() })), sounds: v.array(v.object({ name: v.string(), clipId: v.optional(v.string()), platform: v.string(), source: v.string(), why: v.string(), howToUse: v.string(), licensedForBusiness: v.optional(v.boolean()) })), dropped: v.array(v.string()), lookups: v.array(v.string()) },
  handler: async (ctx, a): Promise<Id<"finishes">> => await ctx.db.insert("finishes", { ...a, createdAt: Date.now() }),
});

/** Her reasons, for "why that caption?" (the finish_notes tool). */
export const recent = internalQuery({
  args: { creatorId: v.id("creators"), limit: v.optional(v.number()) },
  handler: async (ctx, a): Promise<Array<{ at: number; about: string; captions: Array<{ n: number; text: string; shape: string; why: string }>; sounds: Array<{ name: string; why: string; source: string }>; outcome: Doc<"finishes">["outcome"] | null }>> => {
    const rows = (await ctx.db.query("finishes").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(a.limit ?? 3)) as Doc<"finishes">[];
    return rows.map((r) => ({ at: r.createdAt, about: String((r.card as { about?: string } | null)?.about ?? "").slice(0, 200), captions: r.captions.map((c, i) => ({ n: i + 1, ...c })), sounds: r.sounds.map((s) => ({ name: s.name, why: s.why, source: s.source })), outcome: r.outcome ?? null }));
  },
});

export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g || !g.target) return { ok: false, reason: "message not found" };
    const { creator, directives, target } = g;
    const reply = async (body: string, extra: { produced?: ReturnType<typeof producedStamp>; criticSkipped?: boolean } = {}) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `finish:${a.messageId}`, proactive: false, kind: "opinion", ...extra });
      await deliverNow(ctx as never);
    };
    const file = target.fileId ? await ctx.storage.get(target.fileId) : null;
    if (!file) return { ok: false, reason: "no file bytes" };
    await ctx.runAction(internal.core.telegram.react, { creatorId: creator._id, messageId: target._id, emoji: "👀" }).catch(() => undefined);
    const w = await watchBytes(ctx, creator._id, "watch_finish", await file.arrayBuffer(), target.fileMime ?? "video/mp4", FINISH_WATCH_PROMPT);
    const card = w.text ? parseJson<Record<string, unknown>>(w.text) : null;
    if (!card) {
      await reply(`couldn't watch that one (${w.reason ?? "the file didn't open"}). try a smaller export, under 20 MB?`);
      return { ok: true, reason: `watch failed: ${w.reason}` };
    }
    const candidates = await ctx.runQuery(internal.agent.finish.soundCandidates, { creatorId: creator._id, now: Date.now() });
    const prefix = buildPrefix({ creator, directives, skill: FINISH_SKILL, personal: g.personal, voice: g.voice, history: g.history });
    const evidence = { theirWords: target.body.slice(0, 400), card, soundCandidates: candidates, platforms: Object.keys(creator.handles).filter((k) => (creator.handles as Record<string, unknown>)[k]) };
    const user = `Evidence (everything you may cite is here or in a lookup you make):\n${JSON.stringify(evidence)}`;
    const inv = await investigate(ctx, { creatorId: creator._id, sourceMessageId: a.messageId, purpose: "finish", prefix, user, budget: { calls: 5, credits: 12, deadlineAt: Date.now() + 60_000 }, temperature: 0.6, maxTokens: 1800 });
    let out = inv.content ? parseJson<Out>(inv.content) : null;
    if (!out || !Array.isArray(out.captions) || out.captions.length < 2 || !Array.isArray(out.sounds)) {
      await reply("i watched it but my caption ideas came out wrong. send it again in a minute?");
      return { ok: true, reason: `no usable finish: ${inv.ended}` };
    }
    // The critic reads the captions against their own lines: generic or cheesy gets one rewrite.
    const verdict = await critique(ctx, { creatorId: creator._id, kind: "captions", text: out.captions.map((c, i) => `${i + 1}. ${c.text}`).join("\n"), evidence: { card, theirVoice: g.voice.slice(0, 4000) }, voice: (creator.dossier as { voice?: unknown } | undefined)?.voice ?? {}, directives: directives.map((d) => d.verbatim) });
    let criticSkipped = verdict.skipped === true;
    if (!verdict.pass) {
      await ctx.runMutation(internal.eval.expertBench.saveTrace, { creatorId: creator._id, trace: [{ tool: "critic", ok: false, result: `captions: ${verdict.problems.join(", ")} (${verdict.note}) | ${out.captions.map((c) => c.text).join(" / ").slice(0, 600)}` }] }).catch(() => undefined);
      const rw = await callModel(ctx, { creatorId: creator._id, purpose: "finish_rewrite", model: REGISTRY.writer.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `${user}\n\nYour captions were rejected for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite only the captions, fixing exactly that, keeping three different kinds. Output ONLY JSON: {"captions": [{"text": "", "shape": "", "why": ""}]}\n\nPrevious:\n${JSON.stringify(out.captions)}` }], temperature: 0.6, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      const fixed = rw.ok ? parseJson<{ captions: Out["captions"] }>(rw.content) : null;
      if (fixed?.captions?.length && fixed.captions.length >= 2) out = { ...out, captions: fixed.captions };
      else criticSkipped = true;
    }
    const captions = out.captions.slice(0, 3).map((c) => ({ text: String(c.text ?? "").slice(0, 400), shape: String(c.shape ?? ""), why: String(c.why ?? "").slice(0, 200) })).filter((c) => c.text.trim());
    const { kept, dropped } = backedSounds(out.sounds, inv.trace);
    const sounds = kept.length ? kept : [{ name: "your own audio", platform: "both", source: "their-own-audio", why: card.voiceCarriesIt ? "your words are the point here" : "nothing i checked fit this one better", howToUse: "" }];
    await ctx.runMutation(internal.agent.finish.record, {
      creatorId: creator._id, messageId: a.messageId, fileId: target.fileId ?? undefined, card,
      captions,
      sounds: sounds.map((s) => ({ name: s.name.slice(0, 120), clipId: s.clipId, platform: String(s.platform ?? "both"), source: String(s.source ?? ""), why: String(s.why ?? "").slice(0, 200), howToUse: String(s.howToUse ?? "").slice(0, 160), ...("licensedForBusiness" in s && typeof s.licensedForBusiness === "boolean" ? { licensedForBusiness: s.licensedForBusiness } : {}) })),
      dropped, lookups: inv.trace.filter((t) => t.ok).map((t) => t.tool),
    });
    await reply(finishText({ reaction: out.reaction ?? "", read: out.read, captions, sounds, platformNote: out.platformNote }), { produced: producedStamp(REGISTRY.writer.primary), criticSkipped });
    return { ok: true, reason: `finish: ${captions.length} captions, ${sounds.length} sounds${dropped.length ? `, dropped ${dropped.length} unbacked` : ""}` };
  },
});

// ------------------------------------------------------------------ learning from what they posted

export const LESSON_PROMPT = `A creator was offered three captions for a video. Then they posted. Compare what they posted with what was offered. Return ONLY JSON: {"closestCaption": 1|2|3|0, "lesson": "≤160: ONE habit of how THIS person writes captions that the offered ones missed (what they cut, kept, added, their case, emoji, length), or '' if they used one as offered or it teaches nothing"}. The lesson is about how they write, never about the topic. Never invent a habit the two texts don't show.`;

export const unlearned = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, a): Promise<Array<{ finishId: Id<"finishes">; creatorId: Id<"creators">; createdAt: number }>> => {
    const out: Array<{ finishId: Id<"finishes">; creatorId: Id<"creators">; createdAt: number }> = [];
    // Bounded: finishes are a few a week per creator; the index is per creator, so scan the table's recent tail.
    const rows = (await ctx.db.query("finishes").order("desc").take(500)) as Doc<"finishes">[];
    for (const r of rows) if (!r.outcome && r.createdAt < a.now - 3 * 3_600_000 && r.createdAt > a.now - 6 * 86_400_000) out.push({ finishId: r._id, creatorId: r.creatorId, createdAt: r.createdAt });
    return out;
  },
});

export const postedAfter = internalQuery({
  args: { finishId: v.id("finishes") },
  handler: async (ctx, a): Promise<{ finish: Doc<"finishes">; post: { id: Id<"ownPosts">; caption: string; soundClipId: string | null } } | null> => {
    const f = (await ctx.db.get(a.finishId)) as Doc<"finishes"> | null;
    if (!f) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", f.creatorId)).order("desc").take(30)) as Doc<"ownPosts">[];
    const after = posts.filter((p) => p.createTime >= f.createdAt - 3_600_000 && p.createTime <= f.createdAt + 5 * 86_400_000).sort((x, y) => x.createTime - y.createTime)[0];
    return after ? { finish: f, post: { id: after._id, caption: after.caption ?? "", soundClipId: after.soundClipId ?? null } } : null;
  },
});

export const saveOutcome = internalMutation({
  args: { finishId: v.id("finishes"), ownPostId: v.id("ownPosts"), closestCaption: v.number(), soundUsed: v.union(v.string(), v.null()), lesson: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const f = (await ctx.db.get(a.finishId)) as Doc<"finishes"> | null;
    if (!f || f.outcome) return null;
    await ctx.db.patch(a.finishId, { outcome: { ownPostId: a.ownPostId, closestCaption: a.closestCaption, soundUsed: a.soundUsed, lesson: a.lesson, at: Date.now() } });
    // One caption habit becomes a preference she sees every turn, with the post it came from.
    if (a.lesson.trim()) await ctx.db.insert("personalRecords", { creatorId: f.creatorId, key: `caption-habit:${a.finishId}`, kind: "preference", text: `how they write captions: ${a.lesson.trim()}`, reason: "what they posted vs the captions offered", sourceMessageIds: [f.messageId], sourcePostIds: [a.ownPostId], sourceNoteIds: [], active: true, at: Date.now() });
    return null;
  },
});

export const learnOne = internalAction({
  args: { finishId: v.id("finishes") },
  handler: async (ctx, a): Promise<{ learned: boolean; reason: string }> => {
    const m = await ctx.runQuery(internal.agent.finish.postedAfter, { finishId: a.finishId });
    if (!m) return { learned: false, reason: "not posted yet" };
    const soundUsed = m.post.soundClipId && m.finish.sounds.some((s) => s.clipId === m.post.soundClipId) ? m.post.soundClipId : null;
    const r = await callModel(ctx, { creatorId: m.finish.creatorId, purpose: "finish_lesson", model: REGISTRY.critic.primary, messages: [{ role: "system", content: LESSON_PROMPT }, { role: "user", content: `Offered:\n${m.finish.captions.map((c, i) => `${i + 1}. ${c.text}`).join("\n")}\n\nPosted:\n${m.post.caption.slice(0, 1200)}` }], temperature: 0, maxTokens: 300, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    const parsed = r.ok ? parseJson<{ closestCaption: number; lesson: string }>(r.content) : null;
    if (!parsed) return { learned: false, reason: "lesson model failed" };
    await ctx.runMutation(internal.agent.finish.saveOutcome, { finishId: a.finishId, ownPostId: m.post.id, closestCaption: [0, 1, 2, 3].includes(parsed.closestCaption) ? parsed.closestCaption : 0, soundUsed, lesson: String(parsed.lesson ?? "").slice(0, 200) });
    return { learned: true, reason: parsed.lesson ? "lesson kept" : "used as offered" };
  },
});

export const learnAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const due = await ctx.runQuery(internal.agent.finish.unlearned, { now: Date.now() });
    for (const [i, d] of due.entries()) await ctx.scheduler.runAfter(i * 1_000, internal.agent.finish.learnOne, { finishId: d.finishId });
    return { scheduled: due.length };
  },
});
