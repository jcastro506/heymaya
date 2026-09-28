/**
 * K1: the kit's settings and its per-brand links, through ONE shared function per action, so the app
 * and a text do the same thing (principle 7). Partner tier only: every door refuses below it.
 *
 * - The one line: she proposes it; it goes on the page only once they approve it (or write it themselves).
 * - The audience on the public page: opt-in, their answer kept.
 * - The photo: their profile picture by default, one they send (copied to its own storage, since
 *   message files age out), or none. Never generated, never edited.
 * - A per-brand link: the same kit, leading with posts she picked (theirs, checked by code) and one
 *   idea. It dies when the relationship closes. Opens count only after the pitch went out.
 */
import { v } from "convex/values";
import { z } from "zod";
import { internalQuery, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internalMutation, mutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { CLOSED, Opportunity } from "./contracts";
import { partnershipsOpen } from "./store";
import { kitSettings } from "./kitData";
import { kitUrl } from "./kitPage";

export const KIT_REFUSED = "Media kits are on the partnerships plan";
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

const Share = z.object({ label: z.string().trim().min(1).max(60), share: z.number().min(0).max(1) });
export const KitChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("propose_one_line"), text: z.string() }),
  z.object({ op: z.literal("approve_one_line") }),
  z.object({ op: z.literal("edit_one_line"), text: z.string() }),
  z.object({ op: z.literal("audience"), on: z.boolean() }),
  z.object({ op: z.literal("photo"), source: z.enum(["auto", "none"]) }),
  z.object({ op: z.literal("photo_upload"), storageId: z.string() }),
  z.object({ op: z.literal("tiktok_audience"), age: z.array(Share).max(10), gender: z.array(Share).max(4), countries: z.array(Share).max(10) }),
  z.object({ op: z.literal("ask"), kind: z.enum(["photo", "tiktok_audience"]) }),
  z.object({ op: z.literal("asked"), key: z.enum(["audience", "oneLine", "photo"]) }),
  z.object({ op: z.literal("photo_check"), weak: z.boolean(), reason: z.string().max(200) }),
]);
export type KitChangeT = z.infer<typeof KitChange>;

/** Pure: a known type must be an image; an unlabelled file is allowed (it passed the vision check, or the app sent it). */
export function photoTypeOk(contentType: string | undefined | null): boolean {
  return !contentType || /^image\/(jpeg|png|heic|heif|webp)$/i.test(contentType);
}

/** Pure: a one line is words about them, not a stat sheet or a link. Throws the reason. */
export function checkOneLine(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
  if (t.length < 8) throw new Error("The one line is too short");
  if (t.length > 140) throw new Error("The one line must be 140 characters or fewer");
  if (/\d/.test(t)) throw new Error("No numbers in the one line: the numbers live in the stats, from their rows");
  if (/https?:|www\.|@|#/.test(t)) throw new Error("No links, handles or hashtags in the one line");
  return t;
}

async function openFor(ctx: MutationCtx | QueryCtx, creatorId: Id<"creators">): Promise<Doc<"creators">> {
  const c = (await ctx.db.get(creatorId)) as Doc<"creators"> | null;
  if (!c || c.plan.status === "deleting" || !partnershipsOpen(c)) throw new Error(KIT_REFUSED);
  return c;
}

/** The one shared function every door uses. */
export async function applyKitChange(ctx: MutationCtx, creatorId: Id<"creators">, change: KitChangeT, now = Date.now()): Promise<{ ok: true; note: string }> {
  await openFor(ctx, creatorId);
  const row = await kitSettings(ctx, creatorId);
  const id = row?._id ?? (await ctx.db.insert("mediaKits", { creatorId, updatedAt: now }));
  const cur = (row ?? (await ctx.db.get(id))) as Doc<"mediaKits">;
  const patch: Partial<Doc<"mediaKits">> = { updatedAt: now };
  const dropUpload = async () => {
    if (cur.photo?.source === "upload" && cur.photo.storageId) await ctx.storage.delete(cur.photo.storageId).catch(() => undefined);
  };
  let note = "saved";
  switch (change.op) {
    case "propose_one_line":
      patch.oneLine = { text: checkOneLine(change.text), status: "proposed", at: now };
      note = "proposed; it goes on the kit once they say yes";
      break;
    case "edit_one_line":
      patch.oneLine = { text: checkOneLine(change.text), status: "approved", at: now };
      note = "their words, on the kit";
      break;
    case "approve_one_line": {
      if (!cur.oneLine || cur.oneLine.status !== "proposed") throw new Error("There is no proposed one line to approve");
      // Their yes has to come after the proposal: an approval from before it isn't one.
      const reply = await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creatorId).gt("ts", cur.oneLine!.at)).filter((q) => q.eq(q.field("direction"), "in")).first();
      if (!reply) throw new Error("They haven't answered the proposed one line yet");
      patch.oneLine = { ...cur.oneLine, status: "approved", at: now };
      note = "approved; on the kit";
      break;
    }
    case "audience":
      patch.showAudience = change.on;
      patch.asked = { ...(cur.asked ?? {}), audience: cur.asked?.audience ?? now };
      note = change.on ? "their audience shows on the public kit" : "their audience is off the public kit";
      break;
    case "photo":
      await dropUpload();
      patch.photo = { source: change.source, at: now };
      note = change.source === "none" ? "no photo on the kit" : "their profile picture is the kit photo";
      break;
    case "photo_upload": {
      const meta = (await ctx.db.system.get(change.storageId as Id<"_storage">)) as { contentType?: string; size: number } | null;
      if (!meta) throw new Error("That photo isn't stored");
      // A type that is known and isn't an image is refused; an unlabelled file (some message attachments) passed the vision check first.
      if (!photoTypeOk(meta.contentType)) throw new Error("The kit photo must be a JPEG, PNG, HEIC or WebP image");
      if (meta.size > PHOTO_MAX_BYTES) throw new Error("The kit photo must be 8 MB or smaller");
      if (cur.photo?.storageId !== change.storageId) await dropUpload();
      patch.photo = { source: "upload", storageId: change.storageId as Id<"_storage">, at: now };
      patch.pendingAsk = undefined;
      note = "their photo is on the kit";
      break;
    }
    case "tiktok_audience":
      patch.tiktokAudience = { age: change.age, gender: change.gender, countries: change.countries, at: now };
      patch.pendingAsk = undefined;
      note = "their TikTok audience is on the kit, dated today";
      break;
    case "ask":
      patch.pendingAsk = { kind: change.kind, at: now };
      patch.asked = { ...(cur.asked ?? {}), [change.kind === "photo" ? "photo" : "tiktokAudience"]: now };
      note = "their next image goes to the kit";
      break;
    case "asked":
      patch.asked = { ...(cur.asked ?? {}), [change.key]: cur.asked?.[change.key] ?? now };
      break;
    case "photo_check":
      patch.photoCheck = { weak: change.weak, reason: change.reason, checkedAt: now, ...(cur.photoCheck?.offeredAt ? { offeredAt: cur.photoCheck.offeredAt } : {}) };
      break;
  }
  await ctx.db.patch(id, patch);
  return { ok: true, note };
}

/** Pure: which one kit question is next, if any (the rule: one question at a time, each asked once). */
export function nextKitQuestion(s: { asked?: Record<string, number>; showAudience?: boolean; oneLine?: { status: string } | null; photoCheck?: { weak: boolean; offeredAt?: number } | null; photoSource?: string }, hasAudience: boolean): "audience" | "oneLine" | "photo" | null {
  if (hasAudience && s.showAudience === undefined && !s.asked?.audience) return "audience";
  if ((!s.oneLine || s.oneLine.status === "proposed") && !s.asked?.oneLine) return "oneLine";
  if ((s.photoSource ?? "auto") === "auto" && s.photoCheck?.weak && !s.photoCheck.offeredAt && !s.asked?.photo) return "photo";
  return null;
}

// ------------------------------------------------------------------ doors

export const change = internalMutation({
  args: { creatorId: v.id("creators"), change: v.any() },
  handler: async (ctx, a): Promise<{ ok: true; note: string }> => await applyKitChange(ctx, a.creatorId, KitChange.parse(a.change)),
});

/** Marks the weak-photo offer as made, once, whatever was said around it. */
export const photoOffered = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<void> => {
    const row = await kitSettings(ctx, a.creatorId);
    if (row?.photoCheck && !row.photoCheck.offeredAt) await ctx.db.patch(row._id, { photoCheck: { ...row.photoCheck, offeredAt: Date.now() }, pendingAsk: { kind: "photo", at: Date.now() }, asked: { ...(row.asked ?? {}), photo: Date.now() }, updatedAt: Date.now() });
  },
});

const APP_OPS = new Set(["edit_one_line", "approve_one_line", "audience", "photo", "photo_upload"]);
/** The app's door: the same function, only the ops a person makes by hand. */
export const update = mutation({
  args: { change: v.any() },
  handler: async (ctx, a): Promise<{ ok: true; note: string }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) throw new Error("Not signed in");
    const parsed = KitChange.parse(a.change);
    if (!APP_OPS.has(parsed.op)) throw new Error("Not an app action");
    if (parsed.op === "approve_one_line") {
      // In the app the tap IS their answer: approve directly, no inbound message needed.
      const row = await kitSettings(ctx, c._id);
      if (!row?.oneLine) throw new Error("There is no proposed one line to approve");
      return await applyKitChange(ctx, c._id, { op: "edit_one_line", text: row.oneLine.text });
    }
    return await applyKitChange(ctx, c._id, parsed);
  },
});

/** The app's door with flat arguments (the Swift client sends plain fields); the same shared function. */
export const appUpdate = mutation({
  args: { op: v.string(), text: v.optional(v.string()), on: v.optional(v.boolean()), source: v.optional(v.string()), storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, a): Promise<{ ok: true; note: string }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) throw new Error("Not signed in");
    const change = a.op === "edit_one_line" ? { op: a.op, text: a.text ?? "" }
      : a.op === "approve_one_line" ? { op: a.op }
      : a.op === "audience" ? { op: a.op, on: a.on === true }
      : a.op === "photo" ? { op: a.op, source: a.source === "none" ? "none" : "auto" }
      : a.op === "photo_upload" ? { op: a.op, storageId: a.storageId ?? "" }
      : null;
    if (!change) throw new Error("Not an app action");
    const parsed = KitChange.parse(change);
    if (parsed.op === "approve_one_line") {
      const row = await kitSettings(ctx, c._id);
      if (!row?.oneLine) throw new Error("There is no proposed one line to approve");
      return await applyKitChange(ctx, c._id, { op: "edit_one_line", text: row.oneLine.text });
    }
    return await applyKitChange(ctx, c._id, parsed);
  },
});

export const photoUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const c = await creatorForIdentity(ctx);
    if (!c) throw new Error("Not signed in");
    await openFor(ctx, c._id);
    return await ctx.storage.generateUploadUrl();
  },
});

export const settingsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Doc<"mediaKits"> | null> => await kitSettings(ctx, a.creatorId),
});

// ------------------------------------------------------------------ per-brand links

function variantSlug(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** Pure: a post URL, compared without query strings or a trailing slash. */
export function samePost(a: string, b: string): boolean {
  const n = (u: string) => u.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

export async function upsertVariant(ctx: MutationCtx, creatorId: Id<"creators">, a: { opportunityId: Id<"partnershipOpportunities">; postUrls: string[]; idea: string }, now = Date.now()): Promise<{ url: string; brand: string }> {
  await openFor(ctx, creatorId);
  const opp = (await ctx.db.get(a.opportunityId)) as Doc<"partnershipOpportunities"> | null;
  if (!opp || opp.creatorId !== creatorId) throw new Error("Opportunity unavailable");
  const data = Opportunity.parse(opp.data);
  if (CLOSED.has(data.status)) throw new Error("That relationship is closed; its kit link is gone");
  if (!a.postUrls.length || a.postUrls.length > 3) throw new Error("Pick 1 to 3 of their posts to lead with");
  const own = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(300)) as Doc<"ownPosts">[];
  const urls: string[] = [];
  for (const u of a.postUrls) {
    const hit = own.find((p) => samePost(p.url, u));
    if (!hit) throw new Error(`Not one of their posts: ${u.slice(0, 120)}. Lead only with posts from media_kit.`);
    if (!urls.includes(hit.url)) urls.push(hit.url);
  }
  const idea = a.idea.replace(/\s+/g, " ").trim();
  if (idea.length < 10 || idea.length > 240) throw new Error("The idea for them is 10 to 240 characters, one concrete idea");
  const existing = (await ctx.db.query("kitVariants").withIndex("by_opportunity", (q) => q.eq("opportunityId", a.opportunityId)).first()) as Doc<"kitVariants"> | null;
  if (existing) {
    await ctx.db.patch(existing._id, { postUrls: urls, idea, brand: data.brand });
    return { url: kitUrl(existing.slug), brand: data.brand };
  }
  const slug = variantSlug();
  await ctx.db.insert("kitVariants", { creatorId, opportunityId: a.opportunityId, slug, brand: data.brand, postUrls: urls, idea, createdAt: now });
  return { url: kitUrl(slug), brand: data.brand };
}

export const variantFor = internalMutation({
  args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities"), postUrls: v.array(v.string()), idea: v.string() },
  handler: async (ctx, a): Promise<{ url: string; brand: string }> => await upsertVariant(ctx, a.creatorId, a),
});

export const variantOf = internalQuery({
  args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") },
  handler: async (ctx, a): Promise<{ url: string; openedAt: number | null; id: Id<"kitVariants"> } | null> => {
    const r = (await ctx.db.query("kitVariants").withIndex("by_opportunity", (q) => q.eq("opportunityId", a.opportunityId)).first()) as Doc<"kitVariants"> | null;
    return r && r.creatorId === a.creatorId ? { url: kitUrl(r.slug), openedAt: r.openedAt ?? null, id: r._id } : null;
  },
});

/** Pure: link previews and crawlers aren't a person opening the kit. */
export function looksLikeBot(userAgent: string | null | undefined): boolean {
  return !userAgent || /bot|crawler|spider|preview|facebookexternalhit|slurp|whatsapp|telegram|discord|google-|bingpreview|headless|curl|wget|python|node-fetch/i.test(userAgent);
}

/**
 * The page reports a view. Counted only for a per-brand link, only after the pitch went out, never a
 * preview bot, never the creator themself (the page passes their signed-in id, if any).
 */
export const recordOpen = mutation({
  args: { slug: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ counted: boolean }> => {
    if (!/^[a-z0-9]{8,40}$/.test(a.slug) || looksLikeBot(a.userAgent)) return { counted: false };
    const r = (await ctx.db.query("kitVariants").withIndex("by_slug", (q) => q.eq("slug", a.slug)).first()) as Doc<"kitVariants"> | null;
    if (!r || r.openedAt) return { counted: false };
    const identity = await ctx.auth.getUserIdentity();
    const c = (await ctx.db.get(r.creatorId)) as Doc<"creators"> | null;
    if (!c || (identity && identity.subject === c.clerkUserId)) return { counted: false };
    const opp = (await ctx.db.get(r.opportunityId)) as Doc<"partnershipOpportunities"> | null;
    const d = opp ? Opportunity.safeParse(opp.data) : null;
    if (!d?.success || !d.data.lastOutboundAt || Date.now() < d.data.lastOutboundAt + 60_000 || CLOSED.has(d.data.status)) return { counted: false };
    await ctx.db.patch(r._id, { openedAt: Date.now() });
    return { counted: true };
  },
});

/** The opened notice's input for the follow-up worker: once per brand, inside its one-a-day rail. */
export const openedUntold = internalQuery({
  args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") },
  handler: async (ctx, a): Promise<{ id: Id<"kitVariants">; brand: string; openedAt: number } | null> => {
    const r = (await ctx.db.query("kitVariants").withIndex("by_opportunity", (q) => q.eq("opportunityId", a.opportunityId)).first()) as Doc<"kitVariants"> | null;
    return r && r.creatorId === a.creatorId && r.openedAt && !r.openedToldAt ? { id: r._id, brand: r.brand, openedAt: r.openedAt } : null;
  },
});

export const markOpenedTold = internalMutation({
  args: { id: v.id("kitVariants") },
  handler: async (ctx, a): Promise<void> => { await ctx.db.patch(a.id, { openedToldAt: Date.now() }); },
});

/** The app: their kit's variants (brand, link, opened). */
export const myVariants = query({
  args: {},
  handler: async (ctx): Promise<Array<{ brand: string; url: string; opened: boolean; live: boolean }>> => {
    const c = await creatorForIdentity(ctx);
    if (!c || !partnershipsOpen(c)) return [];
    const rows = (await ctx.db.query("kitVariants").withIndex("by_creator", (q) => q.eq("creatorId", c._id)).order("desc").take(30)) as Doc<"kitVariants">[];
    const out = [];
    for (const r of rows) {
      const opp = (await ctx.db.get(r.opportunityId)) as Doc<"partnershipOpportunities"> | null;
      const d = opp ? Opportunity.safeParse(opp.data) : null;
      out.push({ brand: r.brand, url: kitUrl(r.slug), opened: Boolean(r.openedAt), live: Boolean(d?.success && !CLOSED.has(d.data.status)) });
    }
    return out;
  },
});
