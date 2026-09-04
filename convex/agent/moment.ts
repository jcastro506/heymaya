/**
 * In the moment (plan Sprint 3d). They are somewhere, or something just happened, and
 * they want to make something now: a sentence, a photo of the place, a clip of the
 * scene. She reads what is there (Gemini on the image or the clip), holds it against
 * who they are, what they take and what is on their calendar, and comes back with two
 * angles shaped to them and one she'd make, as an idea row they can act on from the
 * chat: shot list, block time now, save, or edit it in plain words.
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
import { watchMedia } from "../integrations/gemini/client";

export const MOMENT_SKILL = `If the plan in the prefix shows a film block HAPPENING NOW, you are the producer on set: read what they sent against that block's hook and shot list, say what is working and the one thing to get before they wrap, and skip the general idea-finding. Mark nothing as filmed yourself; their clip is the sign.

moment
When: they are somewhere or something just happened and they want to make content about it now. You may have a photo or a clip of the scene (described in the evidence as what is visible, not judged) and their words.
The judgment: what is actually here that is worth a post FOR THEM: their formats, their register, what they take, what they've posted before that rhymes, what's on their calendar. Give two angles, both shot in the next twenty minutes with a phone: each with a hook line (≤ 100), three to five shots (≤ 60 each, in order), a length in seconds, and the on-screen text if any. Pick the one you'd make and say why in one line. If the place or the moment is a bad fit, say so and offer the one thing that would work. Never invent what is in the scene beyond the description.
Output ONLY JSON:
{"message": "≤600 chars in your voice, the read of the moment, then the two angles in prose, then which one and why, ending with a question that picks one", "ideas": [{"hook": "", "shots": ["", ""], "lengthSec": 20, "onScreenText": ""}, {"hook": "", "shots": [""], "lengthSec": 30, "onScreenText": ""}], "recommended": 0, "features": {"format": "", "topics": [""], "tone": "", "lengthBucket": "<15|15-30|30-60|60+", "sound": "none|original|trending"}}`;

const SCENE_PROMPT = `Describe what is in this image or clip for someone who will decide what to film here. Facts only: the kind of place or situation, what is visible, light, people, objects, movement, text, sound if any (for a clip), anything unusual. ≤ 700 characters, no advice, no judgment.`;

export const sceneKindOf = `Is this image or clip (a) a screenshot of an app, analytics or a profile, (b) a finished or edited video post / draft, or (c) a raw photo or clip of a place, a person, a moment? Answer one word: screenshot, draft, or scene.`;

/** Gemini decides what the file is, so a photo of a restaurant is never read as analytics. */
export const kindOfMedia = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<"screenshot" | "draft" | "scene" | "unknown"> => {
    const m = await ctx.runQuery(internal.agent.moment.messageFile, { messageId: a.messageId });
    if (!m?.fileId) return "unknown";
    const file = await ctx.storage.get(m.fileId);
    if (!file) return "unknown";
    const r = await watchMedia({ model: WATCH_MODEL_TOP, apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "", prompt: sceneKindOf, media: { bytes: await file.arrayBuffer(), mimeType: m.fileMime ?? "image/jpeg" }, resolution: "low", maxOutputTokens: 5 });
    if (r.usage) await ctx.runMutation(internal.core.costs.record, { creatorId: m.creatorId, vendor: "gemini", resource: WATCH_MODEL_TOP, purpose: "media_kind", costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
    const w = r.ok ? r.text.trim().toLowerCase() : "";
    return w.startsWith("screenshot") ? "screenshot" : w.startsWith("draft") ? "draft" : w.startsWith("scene") ? "scene" : "unknown";
  },
});

export const messageFile = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; fileId?: Id<"_storage">; fileMime?: string; body: string } | null> => {
    const m = (await ctx.db.get(a.messageId)) as Doc<"messages"> | null;
    return m ? { creatorId: m.creatorId, fileId: m.fileId, fileMime: m.fileMime, body: m.body } : null;
  },
});

export const writeMomentIdea = internalMutation({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), idea: v.object({ hook: v.string(), shots: v.array(v.string()), lengthSec: v.number(), onScreenText: v.string() }), messageText: v.string(), features: v.optional(v.any()), produced: v.object({ skillVersion: v.string(), model: v.string(), thresholdsVersion: v.string() }) },
  handler: async (ctx, a): Promise<Id<"ideas">> => {
    const f = (a.features ?? {}) as { format?: string; topics?: string[]; tone?: string; lengthBucket?: string; sound?: string };
    const now = Date.now();
    return await ctx.db.insert("ideas", {
      creatorId: a.creatorId,
      evidenceLinks: [],
      fit: "yes",
      fitWhy: "made in the moment, with them",
      version: { hook: a.idea.hook, shotList: a.idea.shots, lengthSec: a.idea.lengthSec, onScreenText: a.idea.onScreenText },
      messageText: a.messageText,
      status: "sent",
      newForYou: false,
      features: { format: String(f.format ?? "other"), topics: (f.topics ?? []).map(String).slice(0, 3), tone: String(f.tone ?? "unknown"), lengthBucket: String(f.lengthBucket ?? "unknown"), sound: String(f.sound ?? "none"), source: "moment" },
      produced: a.produced,
      createdAt: now,
      sentAt: now,
      messageId: a.messageId,
    });
  },
});

/** The whole path: scene (if any) → the read → an idea row → the message with the buttons. */
export const run = internalAction({
  args: { creatorId: v.id("creators"), messageId: v.id("messages"), hasMedia: v.boolean() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId: a.messageId });
    if (!g?.target) return { ok: false, reason: "message not found" };
    const { creator, directives, target, personal, voice } = g;
    const reply = async (body: string, extra: Record<string, unknown> = {}) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `moment:${a.messageId}`, proactive: false, kind: "moment", ...extra });
      await deliverNow(ctx as never);
    };

    let scene: string | null = null;
    if (a.hasMedia && target.fileId) {
      await ctx.runAction(internal.core.telegram.react, { creatorId: creator._id, messageId: target._id, emoji: "👀" }).catch(() => undefined); // §21.5: she's looking
      const file = await ctx.storage.get(target.fileId);
      if (file) {
        const r = await watchMedia({ model: WATCH_MODEL_TOP, apiKey: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "", prompt: SCENE_PROMPT, media: { bytes: await file.arrayBuffer(), mimeType: target.fileMime ?? "image/jpeg" }, resolution: "default", maxOutputTokens: 400 });
        if (r.usage) await ctx.runMutation(internal.core.costs.record, { creatorId: creator._id, vendor: "gemini", resource: WATCH_MODEL_TOP, purpose: "scene_read", costUsd: r.usage.costUsd, promptTokens: r.usage.promptTokens, completionTokens: r.usage.outputTokens, costSource: "endpoint_table" });
        scene = r.ok ? r.text.trim().slice(0, 900) : null;
      }
    }
    const theirWords = target.body.replace(/^\(voice\)\s*/, "").trim();
    if (!scene && theirWords.length < 8) {
      await reply("i'm here. what's the place, or send me a photo of it?");
      return { ok: true, reason: "asked for the scene" };
    }

    const prefix = buildPrefix({ creator, directives, skill: MOMENT_SKILL, personal, voice });
    const spec = REGISTRY.writer;
    const evidence = { theirWords: theirWords.slice(0, 500), scene: scene ?? "no photo or clip; only their words", localTime: new Intl.DateTimeFormat("en-US", { timeZone: creator.timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(Date.now()) };
    const r = await callModel(ctx, { creatorId: creator._id, purpose: "moment", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `The moment:\n${JSON.stringify(evidence)}` }], temperature: 0.6, maxTokens: 1400, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
    type Out = { message: string; ideas: Array<{ hook: string; shots: string[]; lengthSec: number; onScreenText?: string }>; recommended: number; features?: unknown };
    let out: Out | null = null;
    if (r.ok) {
      try {
        const m = r.content.match(/\{[\s\S]*\}/);
        out = m ? (JSON.parse(m[0]) as Out) : null;
      } catch {
        out = null;
      }
    }
    if (!out?.message?.trim() || !Array.isArray(out.ideas) || out.ideas.length === 0) {
      await reply(scene ? `i can see it (${scene.slice(0, 120)}…) but i couldn't land an angle i'd stand behind. give me one more detail: what's the story here for you?` : "tell me one more thing about where you are and i'll give you two angles.");
      return { ok: true, reason: "no angle" };
    }

    const dossierVoice = creator.dossier as { voice?: unknown; persona?: unknown } | undefined;
    let text = out.message.trim();
    let verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "over the length cap" } : await critique(ctx, { creatorId: creator._id, kind: "moment", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
    if (!verdict.pass) {
      const rw = await callModel(ctx, { creatorId: creator._id, purpose: "moment_rewrite", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `The moment:\n${JSON.stringify(evidence)}\n\nYour previous message was rejected by the critic for: ${verdict.problems.join(", ")} (${verdict.note}). Rewrite ONLY the message text, fixing exactly that. Output the text only.` }], temperature: 0.5, maxTokens: 900, apiKey: process.env.OPENROUTER_API_KEY ?? "" });
      if (rw.ok && rw.content.trim()) {
        text = rw.content.trim();
        verdict = tooLong(text) ? { pass: false, problems: ["too_long" as const], note: "still over" } : await critique(ctx, { creatorId: creator._id, kind: "moment", text, evidence, voice: { voice: dossierVoice?.voice, persona: dossierVoice?.persona }, directives: directives.map((d) => d.verbatim) });
      }
      if (!verdict.pass) {
        await reply("i've got two angles but they didn't pass my own check. thirty seconds, ask me again.");
        return { ok: true, reason: `critic: ${verdict.problems.join(", ")}` };
      }
    }

    const pick = out.ideas[Math.min(Math.max(0, Number(out.recommended) || 0), out.ideas.length - 1)];
    const produced = producedStamp(spec.primary);
    const ideaId = await ctx.runMutation(internal.agent.moment.writeMomentIdea, { creatorId: creator._id, messageId: a.messageId, idea: { hook: String(pick.hook ?? "").slice(0, 120), shots: (pick.shots ?? []).map(String).slice(0, 6), lengthSec: Math.max(5, Math.min(180, Number(pick.lengthSec) || 20)), onScreenText: String(pick.onScreenText ?? "").slice(0, 80) }, messageText: text, features: out.features, produced });
    await reply(text, {
      produced,
      criticSkipped: Boolean(verdict.skipped),
      awaitingAnswer: /\?\s*$/.test(text),
      buttons: [
        { id: `idea:${ideaId}:shotlist`, label: "shot list" },
        { id: `idea:${ideaId}:blocknow`, label: "block time now" },
        { id: `idea:${ideaId}:save`, label: "save" },
      ],
    });
    await ctx.scheduler.runAfter(0, internal.agent.memory.index, { creatorId: creator._id, kind: "idea", refId: String(ideaId), text: `${pick.hook}\n${text}` });
    return { ok: true };
  },
});

/** "Block time now": a proposed block starting in fifteen minutes, then the same yes/no as any block. */
export const blockNow = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<{ blockId: Id<"calendarBlocks">; start: number } | null> => {
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!idea || idea.creatorId !== a.creatorId) return null;
    const start = Date.now() + 15 * 60_000;
    const minutes = Math.min(120, Math.max(30, Math.round(((idea.version as { lengthSec?: number } | undefined)?.lengthSec ?? 20) * 2)));
    const blockId = await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: "film", start, end: start + minutes * 60_000, title: `film: ${((idea.version as { hook?: string } | undefined)?.hook ?? "the moment").slice(0, 60)}`, ideaId: a.ideaId, status: "proposed", createdAt: Date.now() });
    return { blockId, start };
  },
});

/** Edits in plain words on the most recent idea (their CRUD): hook, length, on-screen text, sound, shots. */
export const editIdea = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), field: v.union(v.literal("hook"), v.literal("lengthSec"), v.literal("onScreenText"), v.literal("sound"), v.literal("shotList"), v.literal("caption")), value: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!idea || idea.creatorId !== a.creatorId) return { ok: false };
    const version = { ...((idea.version as Record<string, unknown>) ?? {}) };
    if (a.field === "lengthSec") version.lengthSec = Math.max(5, Math.min(180, Number(a.value.replace(/[^\d.]/g, "")) || (version.lengthSec as number) || 20));
    else if (a.field === "shotList") version.shotList = a.value.split(/\n|;|\d+\.\s/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    else version[a.field] = a.value.trim().slice(0, a.field === "caption" ? 300 : 120);
    await ctx.db.patch(idea._id, { version });
    return { ok: true };
  },
});

export const latestIdea = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ id: Id<"ideas">; version: unknown; messageText: string; status: string } | null> => {
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(5)) as Doc<"ideas">[];
    const idea = rows.find((i) => i.status !== "passed" && i.status !== "expired") ?? rows[0];
    return idea ? { id: idea._id, version: idea.version, messageText: idea.messageText, status: idea.status } : null;
  },
});
