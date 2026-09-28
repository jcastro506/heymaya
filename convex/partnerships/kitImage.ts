/**
 * K1: an image for the kit. Two things arrive this way, and one look (Gemini) says which:
 * - a photo of them for the kit ("use this for my media kit", or the photo she asked for). It's
 *   copied to its own storage (message files age out; the kit's must not). Never edited or generated.
 * - a TikTok Studio audience screenshot (TikTok doesn't share an account's audience any other way).
 *   The numbers are read, checked to add up, and stored dated "from your TikTok Studio".
 * Plus her one look at the default photo (their profile picture): weak if it isn't a clear face.
 *
 * The routing decision is code (`kitImageIntent`): an image goes to the kit only when they said so
 * or she asked for one in the last 48 h. Everything else keeps its old path (moment, screenshot read).
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { deliverNow } from "../core/scheduler";
import { parseJson, storedMedia, watchBytes } from "../agent/opinion";
import { avatarKey } from "../media";
import { partnershipsOpen } from "./store";

const PENDING_ASK_MS = 48 * 3_600_000;

export const KIT_IMAGE_PROMPT = `You are looking at one image a creator sent. Return STRICT JSON only:
{"kind":"portrait|tiktok_audience|logo|other","faceClear":true|false,"age":[{"label":"","percent":0}],"gender":[{"label":"","percent":0}],"countries":[{"label":"","percent":0}]}
kind: "portrait" = a real photo where one person's face is clearly visible; "tiktok_audience" = a TikTok Studio / TikTok analytics screen showing viewer or follower age, gender or location percentages; "logo" = a logo, graphic, text or cartoon; "other" = anything else.
Only for tiktok_audience: copy every percentage exactly as shown, with its label ("18-24", "Female", "United States"). Leave arrays empty otherwise. Never estimate a number that isn't printed.`;

type Read = { kind: string; faceClear?: boolean; age?: Array<{ label: string; percent: number }>; gender?: Array<{ label: string; percent: number }>; countries?: Array<{ label: string; percent: number }> };

/** Pure: does this image belong to the kit? Their words, or her ask in the last 48 h. */
export function kitImageIntent(body: string, pendingAsk: { kind: "photo" | "tiktok_audience"; at: number } | null | undefined, now: number): "photo" | "tiktok_audience" | "either" | null {
  const t = body.toLowerCase();
  if (/(tiktok )?studio|audience|demograph|who (watches|follows)/.test(t)) return "tiktok_audience";
  if (/media ?kit|for (my|the) kit|kit (photo|pic)|profile (pic|photo)|headshot|use this (one|photo|pic)/.test(t)) return "photo";
  if (pendingAsk && now - pendingAsk.at <= PENDING_ASK_MS) return pendingAsk.kind;
  return /\bkit\b/.test(t) ? "either" : null;
}

/**
 * Pure: a screenshot's audience, or why not. Age and gender each have to add up (95–101 %: rounding),
 * countries can be a top few (≤ 101 %). Shares become fractions; labels are kept as printed.
 */
export function audienceFromRead(r: Read): { ok: true; age: Array<{ label: string; share: number }>; gender: Array<{ label: string; share: number }>; countries: Array<{ label: string; share: number }> } | { ok: false; reason: string } {
  const clean = (xs: Read["age"]) => (xs ?? []).filter((x) => x && typeof x.label === "string" && x.label.trim() && Number.isFinite(x.percent) && x.percent >= 0 && x.percent <= 100).map((x) => ({ label: x.label.trim().slice(0, 60), share: Math.round(x.percent * 10) / 1000 }));
  const age = clean(r.age), gender = clean(r.gender), countries = clean(r.countries);
  if (!age.length && !gender.length && !countries.length) return { ok: false, reason: "no audience percentages on it" };
  const sum = (xs: Array<{ share: number }>) => Math.round(xs.reduce((n, x) => n + x.share, 0) * 1000) / 10;
  if (age.length && (sum(age) < 95 || sum(age) > 101)) return { ok: false, reason: `the age groups add up to ${sum(age)}%` };
  if (gender.length && (sum(gender) < 95 || sum(gender) > 101)) return { ok: false, reason: `gender adds up to ${sum(gender)}%` };
  if (countries.length && sum(countries) > 101) return { ok: false, reason: `the countries add up to ${sum(countries)}%` };
  return { ok: true, age, gender, countries };
}

/** Pure: a short, grounded summary of a screenshot audience for her reply. */
export function audienceLine(a: { age: Array<{ label: string; share: number }>; gender: Array<{ label: string; share: number }> }): string {
  const top = (xs: Array<{ label: string; share: number }>) => [...xs].sort((x, y) => y.share - x.share)[0];
  const bits: string[] = [];
  const g = top(a.gender);
  if (g) bits.push(`${Math.round(g.share * 100)}% ${g.label.toLowerCase()}`);
  const ag = top(a.age);
  if (ag) bits.push(`mostly ${ag.label}`);
  return bits.join(", ");
}

export const kitImageInputs = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ creatorId: Id<"creators">; open: boolean; body: string; fileId: Id<"_storage"> | null; fileMime: string; pendingAsk: Doc<"mediaKits">["pendingAsk"] | null; fake: string | null } | null> => {
    const m = (await ctx.db.get(a.messageId)) as Doc<"messages"> | null;
    if (!m) return null;
    const c = (await ctx.db.get(m.creatorId)) as Doc<"creators"> | null;
    const kit = (await ctx.db.query("mediaKits").withIndex("by_creator", (q) => q.eq("creatorId", m.creatorId)).first()) as Doc<"mediaKits"> | null;
    // Sims only (local deployment, fakes on, a fixture creator): the vision answer planted for this message.
    let fake: string | null = null;
    if (process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local" && c?.clerkUserId.startsWith("eval:partnership:")) {
      fake = ((await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `eval:fake_vision:${a.messageId}`)).unique()) as Doc<"syncState"> | null)?.value ?? null;
    }
    return { creatorId: m.creatorId, open: Boolean(c && partnershipsOpen(c)), body: m.body ?? "", fileId: m.fileId ?? null, fileMime: m.fileMime ?? "image/jpeg", pendingAsk: kit?.pendingAsk ?? null, fake };
  },
});

async function look(ctx: Parameters<typeof watchBytes>[0], creatorId: Id<"creators">, fileId: Id<"_storage">, mime: string, purpose: string, fake: string | null): Promise<Read | null> {
  if (fake) return parseJson<Read>(fake);
  const bytes = await storedMedia(ctx, fileId, mime);
  if (!bytes) return null;
  const r = await watchBytes(ctx, creatorId, purpose, bytes, mime, KIT_IMAGE_PROMPT, 500);
  return r.text ? parseJson<Read>(r.text) : null;
}

/**
 * The kit's branch for an inbound image. `handled: false` means "not for the kit": the caller keeps
 * its old path. When handled, she has already answered.
 */
export const handle = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, a): Promise<{ handled: boolean; reason: string }> => {
    const inp = await ctx.runQuery(internal.partnerships.kitImage.kitImageInputs, { messageId: a.messageId });
    if (!inp || !inp.open || !inp.fileId) return { handled: false, reason: "not the partnerships plan, or no file" };
    const intent = kitImageIntent(inp.body, inp.pendingAsk, Date.now());
    if (!intent) return { handled: false, reason: "not for the kit" };
    const reply = async (body: string) => {
      await ctx.runMutation(internal.core.messages.send, { creatorId: inp.creatorId, surface: "telegram", body, dedupeKey: `kitimg:${a.messageId}`, proactive: false, kind: "reply" });
      await deliverNow(ctx as never);
    };
    const read = await look(ctx as never, inp.creatorId, inp.fileId, inp.fileMime, "kit_image", inp.fake);
    if (!read) {
      await reply("couldn't get a good look at that one. mind sending it again?");
      return { handled: true, reason: "unreadable" };
    }
    if (read.kind === "tiktok_audience" && intent !== "photo") {
      const aud = audienceFromRead(read);
      if (!aud.ok) {
        await reply(`i can't put that on your kit: ${aud.reason}. can you send the whole audience screen from tiktok studio?`);
        return { handled: true, reason: `audience refused: ${aud.reason}` };
      }
      await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId: inp.creatorId, change: { op: "tiktok_audience", age: aud.age, gender: aud.gender, countries: aud.countries } });
      const line = audienceLine(aud);
      await reply(`got it, your tiktok audience is on the kit, dated today${line ? ` (${line})` : ""}. brands check this part first.`);
      return { handled: true, reason: "tiktok audience saved" };
    }
    if (read.kind === "portrait" && read.faceClear !== false && intent !== "tiktok_audience") {
      // Its own copy: the message's file ages out with the message.
      const blob = await ctx.storage.get(inp.fileId);
      if (!blob) return { handled: false, reason: "file gone" };
      const storageId = await ctx.storage.store(blob);
      await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId: inp.creatorId, change: { op: "photo_upload", storageId } });
      await reply("done, that's your kit photo now.");
      return { handled: true, reason: "photo saved" };
    }
    if (intent === "photo" || (intent === "either" && read.kind !== "tiktok_audience")) {
      await reply("that doesn't look like a clear photo of you, so i left your kit photo as it was. send one where your face is easy to see and i'll swap it.");
      return { handled: true, reason: `not a portrait: ${read.kind}` };
    }
    if (intent === "tiktok_audience") {
      await reply("that doesn't look like the audience screen. in tiktok studio it's analytics → followers (or viewers). a screenshot of that works.");
      return { handled: true, reason: `not an audience screen: ${read.kind}` };
    }
    return { handled: false, reason: "not for the kit after all" };
  },
});

// ------------------------------------------------------------------ the default photo's one look

export const avatarFile = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ storageId: Id<"_storage">; fake: string | null } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    let fake: string | null = null;
    if (process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local" && c.clerkUserId.startsWith("eval:partnership:")) {
      fake = ((await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", `eval:fake_vision:avatar:${a.creatorId}`)).unique()) as Doc<"syncState"> | null)?.value ?? null;
    }
    for (const p of ["instagram", "tiktok"] as const) {
      const h = c.handles[p];
      if (!h) continue;
      const r = (await ctx.db.query("media").withIndex("by_key", (q) => q.eq("platform", p).eq("kind", "avatar").eq("key", avatarKey(h))).first()) as Doc<"media"> | null;
      if (r?.storageId) return { storageId: r.storageId, fake };
    }
    return fake ? { storageId: "" as Id<"_storage">, fake } : null;
  },
});

/** Once, when the kit is first read: is their profile picture a clear face? Stored; she offers once. */
export const checkDefaultPhoto = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ weak: boolean; reason: string } | null> => {
    const f = await ctx.runQuery(internal.partnerships.kitImage.avatarFile, { creatorId: a.creatorId });
    if (!f) {
      await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId: a.creatorId, change: { op: "photo_check", weak: true, reason: "there's no profile picture to use" } });
      return { weak: true, reason: "no profile picture" };
    }
    const read = await look(ctx as never, a.creatorId, f.storageId, "image/jpeg", "kit_photo_check", f.fake);
    if (!read) return null; // a failed look isn't a verdict; it's tried again next time
    const weak = read.kind !== "portrait" || read.faceClear === false;
    const reason = !weak ? "a clear photo of them" : read.kind === "logo" ? "their profile picture is a logo or graphic" : read.kind === "portrait" ? "their face isn't clear in it" : "their profile picture isn't a photo of them";
    await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId: a.creatorId, change: { op: "photo_check", weak, reason } });
    return { weak, reason };
  },
});
