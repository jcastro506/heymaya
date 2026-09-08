/**
 * Show, don't tell (plan §22, Sprint 4g, 2026-09-08). An idea that lives in how it looks
 * gets drawn: two to four still frames, vertical, a storyboard, sent as one album with a
 * line from her before it. Three doors into the same path: a "show me" tap, the
 * `show_frames` belt tool when they ask in words, and the scout marking a pick visual.
 *
 * Division of labour: the writer answers ONE call with a shot list (style, intro, frames);
 * code clamps and sanitises it, fans out one image request per frame in parallel, stores
 * the results, writes them on the idea row and sends the album. She never loops over an
 * image API in a prompt. Budgets, never booleans: a weekly count per creator, a fleet cap
 * on renders in flight, a cost row per frame.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { deliverNow } from "../core/scheduler";
import { REGISTRY } from "./registry";
import { buildPrefix, producedStamp } from "./context";
import { THRESHOLDS } from "../config/thresholds";
import { fetchMedia } from "../integrations/gemini/client";
import { generateImage, IMAGE_MODEL, IMAGE_MODEL_FALLBACK } from "../integrations/openrouter/images";

export const FRAMES_VERSION = "frames-2026-09-08.1";
export const MIN_FRAMES = 2;
export const MAX_FRAMES = 4;
/** A reference photo bigger than this is not worth the upload; the model only needs the light. */
const REFERENCE_MAX_BYTES = 3 * 1024 * 1024;
/** Stills from their own posts handed to the image model. Three shows a room and a wardrobe; one shows a mood. Post reads are cached seven days. */
export const MAX_REFERENCES = 3;

export type RequestedBy = "tap" | "ask" | "scout";

export const FRAMES_SKILL = `frames (show, don't tell)
When: they tapped "show me" on an idea, asked to see it in words, or the idea lives in how it looks and you chose to draw it.
The judgment: turn the idea into two to four still frames a person glances at and gets the whole post: what is on screen, where the camera is, the on-screen text exactly as it would appear. A storyboard, not a finished post; one clear moment per frame, in the order they happen. Their setting from the dossier (their room, their street, their kitchen, their dog), never their face: the person is a figure from behind, hands, or out of frame. No app interface, no numbers, no logos, no watermarks. The intro is one line to them in your voice, and it says this is a rough sketch of what you mean, not a post.
"them" is how THIS creator shows up in a frame without their face: what they wear as a style (the hoodie, the running vest, the rings), their hair as a style, their usual place with its real details (the narrow flat, the track by the park, the kitchen with the plants), and their recurring props and characters (the dog, the notebook, the espresso cup), every item from the dossier and the cards you were given, none invented; "unknown" for anything the dossier does not say. Never their build, skin, age or face: the person is always from behind, over the shoulder, or hands only.
Output ONLY JSON, no markdown: {"style": "≤160: one line of look shared by all frames (light, palette, setting, mood)", "them": "≤220: how they appear from behind and where, from the dossier only", "intro": "≤140: one line to them before the frames", "frames": [{"scene": "≤220: what is in the frame and where the camera is", "onScreen": "≤60: the text on screen exactly, or ''", "caption": "≤90: what this beat is, for them, in your voice"}]}`;

export interface FramePlan { style: string; them: string; intro: string; frames: Array<{ scene: string; onScreen: string; caption: string }> }

/** Plain text only: the writer's strings become prompts and captions, never markdown, never a wall. */
function clean(s: unknown, max: number): string {
  return String(s ?? "").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The writer's JSON → a plan, or why not. Pure. Two to four frames; more is cut, fewer is refused. */
export function planFromModel(content: string): { ok: true; plan: FramePlan } | { ok: false; reason: string } {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "the frames plan was not JSON" };
  let parsed: { style?: unknown; them?: unknown; intro?: unknown; frames?: unknown };
  try { parsed = JSON.parse(m[0]) as typeof parsed; } catch { return { ok: false, reason: "the frames plan did not parse" }; }
  const raw = Array.isArray(parsed.frames) ? (parsed.frames as Array<Record<string, unknown>>) : [];
  const frames = raw
    .map((f) => ({ scene: clean(f?.scene, 220), onScreen: clean(f?.onScreen, 60), caption: clean(f?.caption, 90) }))
    .filter((f) => f.scene.length > 0)
    .slice(0, MAX_FRAMES);
  if (frames.length < MIN_FRAMES) return { ok: false, reason: `the plan had ${frames.length} usable frame${frames.length === 1 ? "" : "s"}; ${MIN_FRAMES} is the floor` };
  const them = clean(parsed.them, 220);
  return { ok: true, plan: { style: clean(parsed.style, 160), them: /^unknown\.?$/i.test(them) ? "" : them, intro: clean(parsed.intro, 140) || "rough sketch of what i mean, not a post:", frames } };
}

/** One frame's prompt. The rails that keep a sketch from passing for a screenshot live here, in code. */
export function framePrompt(plan: FramePlan, index: number, hasReference: boolean): string {
  const f = plan.frames[index];
  const text = f.onScreen ? `The only text anywhere in the image, rendered exactly, large and legible, as phone-video captions look: "${f.onScreen}".` : "No text anywhere in the image.";
  return [
    `Storyboard frame ${index + 1} of ${plan.frames.length} for a short vertical phone video.`,
    plan.style ? `Look shared by every frame: ${plan.style}.` : "",
    plan.them ? `The person and their place, the same in every frame: ${plan.them}.` : "",
    `This frame: ${f.scene}.`,
    text,
    "Photographic, natural, handheld, like a still from a real phone video; not an illustration, not a render.",
    "No recognisable face, not even in profile: the camera is behind the person, over their shoulder, or on their hands; the face is never visible. Never invent their build, skin or age.",
    "No app interface, no view counts or numbers, no logos, no watermarks, no captions other than the text given.",
    hasReference ? "Match the light, the palette, the clothes and the kind of place in the reference photos, which are stills from the creator's own videos; do not copy their subject or their composition." : "",
  ].filter(Boolean).join(" ");
}

/** The scout's proactive call, pure: a visual pick, room in the week, and the idea actually landed. */
export function shouldDrawProactively(input: { visual: boolean; weekCount: number; sent: boolean }): boolean {
  return input.sent && input.visual && input.weekCount < THRESHOLDS.framesPerWeek;
}

/** The line she sends when the week's sketches are spent. Plain, no invention: the number is the cap. */
export function outOfSketchesLine(): string {
  return `i've used up my ${THRESHOLDS.framesPerWeek} sketches for this week, so this one stays in words for now. next week i can draw it.`;
}

export const FAILED_LINE = "couldn't get the sketch to come out right just now. say the word later and i'll try again.";

const WEEK_MS = 7 * 86_400_000;

/** Frames drawn in the last seven days, from the idea rows (an idea older than 45 days is never drawn). */
export async function weekCountFor(ctx: QueryCtx, creatorId: Id<"creators">, now: number): Promise<number> {
  const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("createdAt", now - 45 * 86_400_000)).collect()) as Doc<"ideas">[];
  return rows.filter((i) => typeof i.framesAt === "number" && i.framesAt >= now - WEEK_MS).length;
}

export const weekCount = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<number> => weekCountFor(ctx, a.creatorId, a.now),
});

export const ideaForFrames = internalQuery({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), now: v.number() },
  handler: async (ctx, a): Promise<{ idea: Doc<"ideas">; weekCount: number; references: Array<{ platform: "tiktok" | "instagram"; url: string }> } | null> => {
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    // Cross-tenant: an idea id from another creator's chat is not theirs to draw.
    if (!idea || idea.creatorId !== a.creatorId) return null;
    const weekCount = await weekCountFor(ctx, a.creatorId, a.now);
    // Their own best recent posts are the light, the clothes and the room the model should match (three stills, not one).
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("createTime", a.now - 180 * 86_400_000)).collect()) as Doc<"ownPosts">[];
    const top = posts.filter((p) => p.contentType === "video" || p.contentType === "photo").sort((x, y) => y.metrics.views - x.metrics.views).slice(0, MAX_REFERENCES);
    return { idea, weekCount, references: top.map((p) => ({ platform: p.platform, url: p.url })) };
  },
});

/** The most recent idea she sent them, for "show me" in words with no idea named. */
export const latestIdeaFor = internalQuery({
  args: { creatorId: v.id("creators"), hint: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ideaId: Id<"ideas">; hook: string } | null> => {
    const rows = (await ctx.db.query("ideas").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(12)) as Doc<"ideas">[];
    const sent = rows.filter((i) => i.sentAt);
    if (!sent.length) return null;
    const hookOf = (i: Doc<"ideas">) => String((i.version as { hook?: string } | undefined)?.hook ?? "");
    const STOP = new Set(["the", "one", "that", "this", "idea", "last", "and", "for", "mock", "show", "draw", "with", "from"]);
    const words = (a.hint ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
    if (words.length) {
      const scored = sent.map((i) => ({ i, score: words.filter((w) => `${hookOf(i)} ${i.messageText}`.toLowerCase().includes(w)).length })).sort((x, y) => y.score - x.score);
      if (scored[0].score > 0) return { ideaId: scored[0].i._id, hook: hookOf(scored[0].i) };
    }
    return { ideaId: sent[0]._id, hook: hookOf(sent[0]) };
  },
});

export const attach = internalMutation({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), requestedBy: v.union(v.literal("tap"), v.literal("ask"), v.literal("scout")), frames: v.array(v.object({ storageId: v.id("_storage"), caption: v.string() })), now: v.number() },
  handler: async (ctx, a): Promise<null> => {
    const idea = (await ctx.db.get(a.ideaId)) as Doc<"ideas"> | null;
    if (!idea || idea.creatorId !== a.creatorId) return null;
    await ctx.db.patch(a.ideaId, { frames: a.frames, framesAt: a.now, framesBy: a.requestedBy });
    return null;
  },
});

/**
 * Draw one idea. The `render_frames` job handler's body, and the dev helper's. Sends
 * exactly one message: the album with the intro, the cached album again, the out-of-
 * sketches line, or the failure line. Never throws; the result names what happened.
 */
export const render = internalAction({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), requestedBy: v.union(v.literal("tap"), v.literal("ask"), v.literal("scout")), requestId: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason: string; frames: number; costUsd: number }> => {
    const now = Date.now();
    const found = await ctx.runQuery(internal.agent.frames.ideaForFrames, { creatorId: a.creatorId, ideaId: a.ideaId, now });
    if (!found) return { ok: false, reason: "not their idea", frames: 0, costUsd: 0 };
    const { idea, weekCount, references: referencePosts } = found;
    const gathered = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId });
    if (!gathered) return { ok: false, reason: "creator not found", frames: 0, costUsd: 0 };
    const { creator, directives } = gathered;
    const send = async (body: string, extra: Record<string, unknown> = {}) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: creator._id, surface: "telegram", body, dedupeKey: `frames:${a.ideaId}:${a.requestId ?? a.requestedBy}${extra.frames ? "" : ":line"}`, proactive: false, kind: "frames", ...extra });
      await deliverNow(ctx as never);
    };

    // Already drawn: the same album again, for free.
    if (idea.frames && idea.frames.length >= MIN_FRAMES) {
      await send(a.requestedBy === "scout" ? "drew it so you can see it:" : "here it is again:", { frames: idea.frames });
      return { ok: true, reason: "cached", frames: idea.frames.length, costUsd: 0 };
    }
    if (weekCount >= THRESHOLDS.framesPerWeek) {
      // The scout asked on its own; the creator did not, so they hear nothing about a limit they never hit.
      if (a.requestedBy !== "scout") await send(outOfSketchesLine());
      return { ok: false, reason: `week's sketches spent (${weekCount} of ${THRESHOLDS.framesPerWeek})`, frames: 0, costUsd: 0 };
    }

    const spec = REGISTRY.writer;
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const prefix = buildPrefix({ creator, directives, skill: FRAMES_SKILL, personal: gathered.personal, voice: gathered.voice, history: gathered.history });
    const planned = await callModel(ctx, { creatorId: creator._id, purpose: "frames_plan", model: spec.primary, messages: [{ role: "system", content: prefix }, { role: "user", content: `The idea:\n${JSON.stringify({ hook: (idea.version as { hook?: string } | undefined)?.hook, onScreenText: (idea.version as { onScreenText?: string } | undefined)?.onScreenText, lengthSec: (idea.version as { lengthSec?: number } | undefined)?.lengthSec, message: idea.messageText })}\n\nWrite the frames.` }], temperature: 0.5, maxTokens: 700, apiKey });
    const plan = planned.ok ? planFromModel(planned.content) : { ok: false as const, reason: planned.reason };
    if (!plan.ok) {
      console.error(`[frames] ${creator._id} ${a.ideaId}: no plan: ${plan.reason}`);
      if (a.requestedBy !== "scout") await send(FAILED_LINE);
      return { ok: false, reason: plan.reason, frames: 0, costUsd: 0 };
    }

    // Their own best posts, as the light, the clothes and the room to match. Optional: a missing still degrades to fewer.
    const references: Array<{ bytes: ArrayBuffer; mimeType: string }> = [];
    if (process.env.MODEL_FAKE !== "1") {
      for (const post of referencePosts) {
        try {
          const info = await ctx.runAction(internal.reads.read.read, { kind: "post.info", params: { platform: post.platform, url: post.url }, creatorId: creator._id });
          const thumb = (info.value as { thumbnailUrl?: string | null } | null)?.thumbnailUrl ?? null;
          if (!thumb) continue;
          const media = await fetchMedia(thumb, REFERENCE_MAX_BYTES);
          if (media.ok && media.mimeType.startsWith("image/")) references.push({ bytes: media.bytes, mimeType: media.mimeType });
        } catch (error) {
          console.error(`[frames] reference skipped: ${String(error)}`);
        }
      }
    }

    // One request per frame, in parallel, the fallback model on a refused primary.
    const results = await Promise.all(plan.plan.frames.map(async (_, i) => {
      const prompt = framePrompt(plan.plan, i, references.length > 0);
      let r = await generateImage({ model: IMAGE_MODEL, prompt, references, apiKey });
      if (!r.ok) {
        console.error(`[frames] frame ${i + 1} on ${IMAGE_MODEL}: ${r.reason}; trying ${IMAGE_MODEL_FALLBACK}`);
        r = await generateImage({ model: IMAGE_MODEL_FALLBACK, prompt, references, apiKey });
      }
      return r;
    }));

    let costUsd = 0;
    const frames: Array<{ storageId: Id<"_storage">; caption: string }> = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      // A cost row per frame, on failure too: a refused image still cost the attempt.
      await ctx.runMutation(internal.core.costs.record, { creatorId: creator._id, vendor: "openrouter", resource: r.ok ? r.model : IMAGE_MODEL, purpose: "frames", costUsd: r.ok ? r.costUsd : undefined, now });
      if (!r.ok) { console.error(`[frames] frame ${i + 1} failed: ${r.reason}`); continue; }
      costUsd += r.costUsd ?? 0;
      const storageId = await ctx.storage.store(new Blob([r.bytes], { type: r.mimeType }));
      frames.push({ storageId, caption: plan.plan.frames[i].caption || `frame ${i + 1}` });
    }
    if (frames.length < MIN_FRAMES) {
      const reason = `${frames.length} of ${results.length} frames came back`;
      console.error(`[frames] ${creator._id} ${a.ideaId}: ${reason}`);
      if (a.requestedBy !== "scout") await send(FAILED_LINE);
      return { ok: false, reason, frames: frames.length, costUsd };
    }
    await ctx.runMutation(internal.agent.frames.attach, { creatorId: creator._id, ideaId: a.ideaId, requestedBy: a.requestedBy, frames, now });
    await send(plan.plan.intro, { frames, produced: producedStamp(spec.primary) });
    return { ok: true, reason: "drawn", frames: frames.length, costUsd };
  },
});

/** Queue a render for an idea, the one way every door does it. Idempotent per request. */
export async function enqueueRender(ctx: { runMutation: (ref: never, args: never) => Promise<unknown> }, input: { creatorId: Id<"creators">; ideaId: Id<"ideas">; requestedBy: RequestedBy; requestId: string }): Promise<void> {
  await (ctx as unknown as { runMutation: (ref: typeof internal.core.jobs.enqueue, a: { kind: string; idempotencyKey: string; creatorId: Id<"creators">; payloadJson: string; maxAttempts?: number; leaseMs?: number }) => Promise<unknown> })
    .runMutation(internal.core.jobs.enqueue, { kind: "render_frames", idempotencyKey: `frames:${input.ideaId}:${input.requestId}`, creatorId: input.creatorId, payloadJson: JSON.stringify({ ideaId: input.ideaId, requestedBy: input.requestedBy, requestId: input.requestId }), maxAttempts: 3, leaseMs: 3 * 60_000 });
}

/** Test and dev seam for the belt tool: what the writer would get back from show_frames, through the real runTool. */
export const devToolProbe = internalAction({
  args: { creatorId: v.id("creators"), idea: v.optional(v.string()) },
  handler: async (ctx, a): Promise<string> => {
    const { runTool } = await import("./tools");
    return await runTool(ctx, a.creatorId, { name: "show_frames", args: { ...(a.idea ? { idea: a.idea } : {}), why: "they asked to see it" } }, { calls: 3, credits: 10, deadlineAt: Date.now() + 10_000 }, []);
  },
});

/** Dev only: an idea row from a real dry-run pick, so the operator can see it drawn on a scenario creator (§22 exit criterion). */
export const devSeedIdea = internalMutation({
  args: { creatorId: v.id("creators"), hook: v.string(), onScreenText: v.optional(v.string()), lengthSec: v.optional(v.number()), message: v.string() },
  handler: async (ctx, a): Promise<Id<"ideas">> => {
    const now = Date.now();
    return await ctx.db.insert("ideas", { creatorId: a.creatorId, evidenceLinks: [], fit: "yes", fitWhy: "dev seed from a dry-run pick", version: { hook: a.hook, onScreenText: a.onScreenText ?? "", lengthSec: a.lengthSec ?? 25, sound: "" }, messageText: a.message, produced: { skillVersion: "dev", model: "dev", thresholdsVersion: "dev" }, sentAt: now, status: "sent", createdAt: now } as never);
  },
});

/** Dev only: draw an idea now and return the frame URLs, so the operator can look before a person does. */
export const devRender = internalAction({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas"), requestedBy: v.optional(v.union(v.literal("tap"), v.literal("ask"), v.literal("scout"))) },
  handler: async (ctx, a): Promise<{ ok: boolean; reason: string; frames: number; costUsd: number; urls: string[] }> => {
    const r = await ctx.runAction(internal.agent.frames.render, { creatorId: a.creatorId, ideaId: a.ideaId, requestedBy: a.requestedBy ?? "tap", requestId: `dev:${Date.now()}` });
    const found = await ctx.runQuery(internal.agent.frames.ideaForFrames, { creatorId: a.creatorId, ideaId: a.ideaId, now: Date.now() });
    const urls: string[] = [];
    for (const f of found?.idea.frames ?? []) { const u = await ctx.storage.getUrl(f.storageId); if (u) urls.push(u); }
    return { ...r, urls };
  },
});
