/**
 * K1: her kit tools (partner tier only). `media_kit` reads the kit v2 and says the ONE thing missing
 * (each question asked once, marked by code when it's surfaced); `media_kit_edit` changes it through
 * the shared function the app uses; `kit_for_brand` makes the per-brand link (her picks, checked to be
 * their own posts). Numbers in the tool result are rows; she quotes them, never computes new ones.
 */
import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { OpenRouterTool } from "../integrations/openrouter/client";
import { readKitV2, kitSettings, type KitV2 } from "./kitData";
import { nextKitQuestion } from "./kitSettings";
import { kitUrl } from "./kitPage";
import { Profile } from "./contracts";
import { partnershipsOpen } from "./store";

const str = { type: "string" } as const;

export const KIT_TOOLS: OpenRouterTool[] = [
  { type: "function", function: { name: "media_kit", description: "Their media kit (partnerships plan): photo, one line, per platform followers, typical views, engagement, 30-day growth, audience (Instagram when connected; TikTok only from a TikTok Studio screenshot they sent), best posts of the last 6 months with links, services, brand work, contact, and their PRIVATE deal preferences (never shown to a brand). Ends with `next:`, the one kit question to ask now, if any. Free. Every number in a pitch, a kit or a rate conversation comes from here; nothing else.", parameters: { type: "object", properties: { why: str }, required: ["why"] } } },
  { type: "function", function: { name: "media_kit_edit", description: "Change their kit through the same function the app uses. op: propose_one_line (text: your one line about them, words only, no numbers or links; it waits for their yes) · approve_one_line (after they said yes to it) · their_one_line (text: words THEY gave you, goes on as is) · audience_on / audience_off (their answer about showing their audience on the public kit) · photo_profile (use their profile picture) · photo_none (no photo) · ask_photo (you asked them for a photo: their next image goes to the kit) · ask_tiktok_audience (you asked for their TikTok Studio audience screenshot). Free. Only on their word, except propose_one_line and the two asks.", parameters: { type: "object", properties: { op: { type: "string", enum: ["propose_one_line", "approve_one_line", "their_one_line", "audience_on", "audience_off", "photo_profile", "photo_none", "ask_photo", "ask_tiktok_audience"] }, text: str, why: str }, required: ["op", "why"] } } },
  { type: "function", function: { name: "kit_for_brand", description: "Make (or update) the per-brand link to their kit for one saved opportunity: the same kit, leading with 1 to 3 of THEIR posts you pick as most relevant to that brand (URLs from media_kit), plus one concrete idea for them (the same idea as the pitch). Returns the link to put in a first email pitch. The link dies when that relationship closes. Free.", parameters: { type: "object", properties: { opportunityId: str, postUrls: { type: "array", items: str }, idea: str, why: str }, required: ["opportunityId", "postUrls", "idea", "why"] } } },
];
export const KIT_TOOL_NAMES = new Set(KIT_TOOLS.map((t) => t.function.name).concat(["media_kit_link"]));

export const kitFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ kit: KitV2; link: string | null; settings: Doc<"mediaKits"> | null; prefs: { paidOnly: boolean; minimumRate: string; excludedBrands: string[]; dealTypes: string[] } } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !partnershipsOpen(c)) return null;
    const prof = (await ctx.db.query("partnershipProfiles").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).unique()) as Doc<"partnershipProfiles"> | null;
    const p = Profile.parse(prof?.data ?? {});
    return { kit: await readKitV2(ctx, c), link: c.kitLink ? kitUrl(c.kitLink.slug) : null, settings: await kitSettings(ctx, a.creatorId), prefs: { paidOnly: p.paidOnly, minimumRate: p.minimumRate, excludedBrands: p.excludedBrands, dealTypes: p.dealTypes } };
  },
});

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const n = (x: number) => Math.round(x).toLocaleString("en-US");
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Pure: the kit as she reads it. Private preferences are labelled private. */
export function renderKit(k: KitV2, link: string | null, prefs: { paidOnly: boolean; minimumRate: string; excludedBrands: string[] }, next: string): string {
  const lines: string[] = [];
  lines.push(`kit as of ${day(k.asOf)} · public link: ${link ?? "off"}`);
  lines.push(`photo: ${k.photoSetting === "none" ? "none (their choice)" : k.photo ? (k.photo.source === "upload" ? "the one they sent" : `their ${k.photo.source} profile picture`) : "none available"}${k.photoCheck?.weak && k.photoSetting === "auto" ? ` (weak: ${k.photoCheck.reason})` : ""}`);
  lines.push(`one line: ${k.oneLine ? `${k.oneLine.approved ? "approved" : "proposed, waiting on their yes"}: "${k.oneLine.text}"` : "none yet"} · lane: ${k.lane ?? "not confirmed"}`);
  lines.push(`audience on the public kit: ${k.showAudience === null ? "not asked yet" : k.showAudience ? "yes" : "no (their choice)"}`);
  lines.push(`services: ${k.services.join(", ") || "none listed (deal types not set)"} · region: ${k.region ?? "unknown"} · contact: ${k.contactEmail ?? "none (no mailbox connected)"}`);
  for (const p of k.platforms) {
    const bits = [`${p.platform}${p.handle ? ` @${p.handle}` : ""}: ${p.followers !== null ? `${n(p.followers)} followers${p.followersAsOf ? ` (as of ${day(p.followersAsOf)})` : ""}` : "followers unknown"}`];
    if (p.growth30d) bits.push(`${p.growth30d.net >= 0 ? "+" : ""}${n(p.growth30d.net)} in 30 days`);
    bits.push(p.normalViews !== null ? `typical ${n(p.normalViews)} views` : "typical views not settled yet");
    bits.push(p.engagement ? `engagement ${pct(p.engagement.perView)} of views${p.engagement.perFollower !== null ? ` (${pct(p.engagement.perFollower)} of followers)` : ""}, median of ${p.engagement.posts} posts` : "engagement: too few recent posts");
    lines.push(bits.join(" · "));
    if (p.audience) {
      const top = (xs: Array<{ label: string; share: number }>, k2 = 3) => xs.slice(0, k2).map((x) => `${x.label} ${pct(x.share)}`).join(", ");
      lines.push(`  audience (${p.audience.source === "connected" ? "connected account" : "their TikTok Studio screenshot"}, ${day(p.audience.asOf)}): gender ${top(p.audience.gender)} · age ${top(p.audience.age, 4)} · countries ${top(p.audience.countries)}`);
    } else lines.push(`  audience: ${p.platform === "tiktok" ? (p.audienceStale ? "their TikTok Studio screenshot is over 60 days old (hidden); ask for a fresh one only when a pitch needs it" : "TikTok doesn't share it; a TikTok Studio screenshot adds it") : "not available (Instagram connected with 100+ followers shares it)"}`);
    for (const b of p.best) lines.push(`  - ${n(b.views)} views${b.multiple ? ` (${b.multiple}x their normal)` : ""} · "${b.caption}" · ${b.url}`);
  }
  if (k.brandWork.length) lines.push(`brand work: ${k.brandWork.map((b) => `${b.brand} (${b.source === "deal" ? "a deal in the record" : "their own disclosed post"})`).join(", ")}`);
  lines.push(`PRIVATE, never on a kit or in a pitch unless they say: ${prefs.paidOnly ? "paid only" : "open to gifting/affiliate"}; minimum rate ${prefs.minimumRate}; excluded ${prefs.excludedBrands.join(", ") || "none"}`);
  lines.push(`next: ${next}`);
  return lines.join("\n");
}

const NEXT_WORDS: Record<string, string> = {
  audience: "ask ONCE whether their audience (age, gender, places) can show on the public kit; brands check it first. Then media_kit_edit audience_on or audience_off with their answer.",
  oneLine: "offer ONE line about them for the top of the kit (media_kit_edit propose_one_line: words only, no numbers), and ask if it sounds like them.",
  photo: "their profile picture is weak for a kit; offer ONCE to use a photo of them instead (they can text one), then media_kit_edit ask_photo. Never offer to make or edit one.",
};

export async function runKitTool(ctx: ActionCtx, creatorId: Id<"creators">, name: string, args: Record<string, unknown>, sourceMessageId?: Id<"messages">): Promise<string> {
  if (name === "media_kit") {
    const r = await ctx.runQuery(internal.partnerships.kitTools.kitFor, { creatorId });
    if (!r) return "refused: media kits are on the partnerships plan";
    const s = r.settings;
    if (!s?.photoCheck && (s?.photo?.source ?? "auto") === "auto") await ctx.scheduler.runAfter(0, internal.partnerships.kitImage.checkDefaultPhoto, { creatorId });
    const next = nextKitQuestion({ asked: s?.asked, showAudience: s?.showAudience, oneLine: s?.oneLine ?? null, photoCheck: s?.photoCheck ?? null, photoSource: s?.photo?.source }, r.kit.platforms.some((p) => p.audience));
    // Asked once: surfacing the question in a conversation IS asking it (code marks it, not the model).
    if (next && sourceMessageId) {
      if (next === "photo") await ctx.runMutation(internal.partnerships.kitSettings.photoOffered, { creatorId });
      else await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId, change: { op: "asked", key: next } });
    }
    return renderKit(r.kit, r.link, r.prefs, next ? NEXT_WORDS[next] : "nothing missing; don't ask kit questions");
  }
  if (name === "media_kit_edit") {
    const op = String(args.op ?? "");
    const text = typeof args.text === "string" ? args.text : "";
    const change = op === "propose_one_line" ? { op, text }
      : op === "approve_one_line" ? { op }
      : op === "their_one_line" ? { op: "edit_one_line", text }
      : op === "audience_on" || op === "audience_off" ? { op: "audience", on: op === "audience_on" }
      : op === "photo_profile" || op === "photo_none" ? { op: "photo", source: op === "photo_none" ? "none" : "auto" }
      : op === "ask_photo" || op === "ask_tiktok_audience" ? { op: "ask", kind: op === "ask_photo" ? "photo" : "tiktok_audience" }
      : null;
    if (!change) return `refused: unknown op ${op}`;
    if (!sourceMessageId && !["propose_one_line", "ask_photo", "ask_tiktok_audience"].includes(op)) return "refused: a kit change needs their word in this conversation";
    try {
      const r = await ctx.runMutation(internal.partnerships.kitSettings.change, { creatorId, change });
      return `done: ${r.note}`;
    } catch (e) {
      return `refused: ${String(e instanceof Error ? e.message : e).replace(/^Uncaught Error: /, "").slice(0, 200)}`;
    }
  }
  if (name === "kit_for_brand") {
    const urls = Array.isArray(args.postUrls) ? args.postUrls.map(String) : String(args.postUrls ?? "").split(/[\s,]+/).filter(Boolean);
    try {
      const r = await ctx.runMutation(internal.partnerships.kitSettings.variantFor, { creatorId, opportunityId: String(args.opportunityId ?? "") as Id<"partnershipOpportunities">, postUrls: urls, idea: String(args.idea ?? "") });
      return `the ${r.brand} link to their kit: ${r.url} (leads with the posts you picked, plus your idea). Put this exact link in a first email pitch; it dies when the relationship closes.`;
    } catch (e) {
      return `refused: ${String(e instanceof Error ? e.message : e).replace(/^Uncaught Error: /, "").slice(0, 240)}`;
    }
  }
  return `refused: no kit tool named ${name}`;
}
