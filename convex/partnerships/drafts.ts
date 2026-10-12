import { v } from "convex/values";
import { z } from "zod";
import { internalQuery, query } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { active, event, ownedOpportunity, profile, assertPersonalEvidence, partnershipAllowance } from "./store";
import { CLOSED, Draft, MAX_FOLLOW_UPS, email, line } from "./contracts";
import { APPLICATION_CHECK_IN_DAYS, Opportunity as OpportunitySchema } from "./contracts";
import { checkPlainLanguage } from "../core/plainLanguage";
import { emailSendEnabled } from "./providerConfig";
import { readKitV2 } from "./kitData";
import { kitUrl } from "./kitPage";
import { nextSendAt, pitchProblems, placeholders, sendWhen } from "./pitch";

export const prepare = internalMutation({
  args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages"), input: v.any() },
  handler: async (ctx, a): Promise<unknown> => {
    const c = await active(ctx, a.creatorId);
    const source = await ctx.db.get(a.sourceMessageId) as Doc<"messages"> | null;
    if (!source || source.creatorId !== a.creatorId || source.direction !== "in") throw new Error("User message required");
    if ((await profile(ctx, a.creatorId)).data.paused) throw new Error("Partnerships are paused");
    const input = z.object({ opportunityId: z.string(), subject: line, body: z.string().trim().min(1).max(12000), answers: z.array(z.object({ label: line, answer: z.string().trim().min(1).max(3000) })).max(50).optional() }).strict().parse(a.input);
    const { row, data: o } = await ownedOpportunity(ctx, a.creatorId, input.opportunityId as Id<"partnershipOpportunities">);
    const now = Date.now();
    if (CLOSED.has(o.status) || (o.deadline && o.deadline <= now) || o.route === "unknown") throw new Error("No actionable outreach route");
    // §8.3: two follow-ups at most, then the thread rests, even when asked (deals sim: a third was drafted
    // and a no-response relationship reopened). A reply from them resets it; a fresh contact is new outreach.
    if (o.threadId && (o.followUpCount ?? 0) >= MAX_FOLLOW_UPS && (!o.lastInboundAt || (o.lastOutboundAt && o.lastInboundAt < o.lastOutboundAt))) throw new Error("Two follow-ups already went unanswered; a third tends to cost the relationship. Tell them that, and offer a different contact or a later, fresh pitch instead");
    if (o.assessment.verdict === "pass") throw new Error("This brand was assessed as unsuitable; revisit the assessment first");
    await assertPersonalEvidence(ctx, a.creatorId, o);
    // Fresh research is for NEW outreach. A follow-up or reply in a tracked thread needs none: at day 12 the
    // §8.3 cadence's second follow-up was refused as "stale" (found by the deals world's compressed time).
    if (!o.threadId && o.evidence.every(e => e.checkedAt < now - 7 * 86400000)) throw new Error("Research is stale; refresh the opportunity before drafting");
    const drafts = await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", row._id)).collect();
    const previous = drafts.map(d => Draft.parse(d.data)).filter(d => d.status === "sent").sort((a, b) => b.createdAt - a.createdAt)[0];
    if (o.threadId && previous && input.subject !== previous.subject) throw new Error(`Keep the existing thread subject: ${previous.subject}`);
    if (drafts.some(d => ["sending", "unknown"].includes(Draft.parse(d.data).status))) throw new Error("Resolve the previous send before drafting again");
    if (drafts.some(d => Draft.parse(d.data).status === "sent") && !o.threadId) throw new Error("Existing outreach must be reconciled first");
    const mailbox = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
    const recipient = o.route === "email" ? email.parse(o.contactEmail) : o.routeUrl!;
    if (o.threadId && o.mailboxGeneration !== mailbox?.generation) throw new Error("This relationship belongs to a different mailbox connection");
    const recent = await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(100);
    const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    if (recent.filter(d => d._creationTime >= monthStart).length >= partnershipAllowance(c).draftsPerMonth) throw new Error("Monthly draft allowance reached");
    // A rate on a form is theirs to set (deals sim 2026-09-28: she put "$150" in Sam's rate field). A money
    // answer counts only if they said that number (their messages this month, or their saved minimum rate).
    const moneyAnswers = (input.answers ?? []).filter((x) => /\b(rate|price|fee|budget|charge|cost)\b/i.test(x.label) && /\d/.test(x.answer));
    if (moneyAnswers.length) {
      const theirs = ((await ctx.db.query("messages").withIndex("by_creator_and_ts", q => q.eq("creatorId", a.creatorId).gte("ts", now - 30 * 86400000)).collect()) as Doc<"messages">[]).filter((m) => m.direction === "in").map((m) => m.body).join(" ") + ` ${(await profile(ctx, a.creatorId)).data.minimumRate ?? ""}`;
      const said = new Set((theirs.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
      const unsaid = moneyAnswers.filter((x) => (x.answer.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).some((n) => !said.has(n.replace(/,/g, ""))));
      if (unsaid.length) throw new Error(`Redraft before review: "${unsaid[0].label}" is theirs to set, and they haven't given that number. Leave it out and ask them what they charge`);
    }
    // Every route: no template holes. Refused before the old draft is canceled, so a good draft survives.
    const holes = placeholders([input.subject ?? "", input.body, ...(input.answers ?? []).map((x) => x.answer)].join("\n"));
    if (holes.length) throw new Error(`Redraft before review: fill in or remove ${holes.slice(0, 3).join(", ")}. If you need a number from them (a rate, a date), ask them first and draft after they answer`);
    for (const d of drafts) {
      const old = Draft.parse(d.data);
      if (["draft", "approved"].includes(old.status)) await ctx.db.patch(d._id, { data: { ...old, status: "canceled" }, updatedAt: now });
    }
    // Applications: an answer only for a question the extracted form actually shows (never an invented field).
    if (input.answers?.length) {
      if (o.route !== "application") throw new Error("Answers are for application routes");
      const asked = new Set(o.applicationFields.map((f) => f.label));
      const unknown = input.answers.filter((x) => !asked.has(x.label)).map((x) => x.label);
      if (unknown.length) throw new Error(`Not questions on the form: ${unknown.slice(0, 3).join(", ")}`);
    }
    // K1: the pitch's promises, by code. A broken draft is refused with the reasons; she redrafts.
    if (o.route === "email" || o.route === "dm") {
      const variant = await ctx.db.query("kitVariants").withIndex("by_opportunity", q => q.eq("opportunityId", row._id)).first();
      const kitLinks = [variant ? kitUrl(variant.slug) : null, c.kitLink ? kitUrl(c.kitLink.slug) : null].filter((u): u is string => Boolean(u));
      const problems = pitchProblems({ route: o.route, firstTouch: !o.threadId, brand: o.brand, subject: input.subject, body: input.body, kitLinks }, await readKitV2(ctx, c));
      if (problems.length) throw new Error(`Redraft before review: ${problems.join("; ")}`);
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
    const data = Draft.parse({ sourceMessageId: a.sourceMessageId, revision: drafts.length + 1, channel: o.route, subject: input.subject, body: input.body, ...(input.answers?.length ? { answers: input.answers } : {}), recipient, sender: mailbox?.email, mailboxGeneration: mailbox?.generation, threadId: o.threadId, inReplyTo: o.lastMessageId, status: "draft", approvalCode: code, approvalExpiresAt: now + 86400000, createdAt: now });
    const shareCode = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
    const id = await ctx.db.insert("partnershipDrafts", { creatorId: a.creatorId, opportunityId: row._id, data, updatedAt: now, shareCode });
    // §8.3: an application handed off gets one "did you get to submit it?" two days later.
    if (o.route === "application" && !o.appliedAt) await ctx.db.patch(row._id, { data: OpportunitySchema.parse({ ...o, applicationCheckInAt: now + APPLICATION_CHECK_IN_DAYS.beforeSubmit * 86_400_000 }), updatedAt: now });
    await event(ctx, a.creatorId, row._id, `draft:${id}`, "draft_created", `Revision ${data.revision}; ${data.channel}; ${recipient}`);
    const command = `SEND ${code}`;
    // One tap to send (2026-10-12): without their Gmail connected, the pitch goes as a link to a page that opens it
    // in Gmail or Mail with everything filled in. With Gmail connected, the exact review and SEND code, as before.
    const page = sendPageUrl(shareCode);
    const body = o.route === "email" && mailbox
      ? `here’s the email to review.\n\nFrom: ${mailbox.email}\nTo: ${recipient}\nSubject: ${data.subject}\n\n${data.body}\n\nTo send exactly this email, reply ${command}. This expires in 24 hours. Changes need a new review.`
      : sendPageText(o.route, o.brand, recipient, page);
    if (!checkPlainLanguage(body).ok) throw new Error("The review would be altered by the chat formatter. Rephrase the draft before requesting approval.");
    // Exact approval display is authored by code, never rephrased by the model.
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, body, surface: c.channel.paired ? "telegram" : "web", dedupeKey: `partner-review:${id}`, proactive: false, kind: "reply" });
    return { draftId: id, revision: data.revision, status: "draft", reviewQueued: true, instruction: "The exact review is queued separately. Do not repeat it or say it was sent to the brand." };
  },
});

/** The send page for a draft (web /m/<code>). */
export function sendPageUrl(code: string, env: Record<string, string | undefined> = process.env): string {
  return `${(env.APP_URL ?? "https://hey-maya.ai").replace(/\/$/, "")}/m/${code}`;
}

/** Pure: her text for a pitch they send themselves, one link to a page that has it all. */
export function sendPageText(route: "email" | "dm" | "application" | "unknown", brand: string, recipient: string, page: string): string {
  if (route === "email") return `here’s your pitch to ${brand}, ready to go. tap to open it in your email, give it a read, and hit send:\n${page}\n---\nit goes to ${recipient}, with your media kit linked. tell me once it’s sent, and send me anything they write back.`;
  if (route === "application") return `your ${brand} application answers are ready. open them here, copy each one into their form, and submit:\n${page}\n---\ntell me once you’ve submitted it so i can keep track.`;
  return `here’s a DM for ${brand}. open it here to copy it, then send it from your account:\n${page}\n---\ntell me once it’s sent so i can keep track.`;
}

export const approve = internalMutation({ args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages") }, handler: async (ctx, a): Promise<{ handled: boolean; text?: string; draftId?: Id<"partnershipDrafts"> }> => {
  const source = await ctx.db.get(a.sourceMessageId) as Doc<"messages"> | null;
  if (!source || source.creatorId !== a.creatorId || source.direction !== "in" || source.memoryExcludedAt || source.fileId || source.fileMime || (source.kind && source.kind !== "inbound")) return { handled: false };
  const match = /^SEND ([a-f0-9]{24})( NOW)?$/i.exec(source.body.trim());
  if (!match) return { handled: false };
  const creator = await active(ctx, a.creatorId);
  if ((await profile(ctx, a.creatorId)).data.paused) return { handled: true, text: "partnerships are paused. nothing was sent." };
  const rows = await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).order("desc").take(100);
  const row = rows.find(d => Draft.parse(d.data).approvalCode === match[1].toLowerCase());
  if (!row) return { handled: true, text: "i couldn’t find that review. ask me for a fresh draft." };
  const d = Draft.parse(row.data);
  const review = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", q => q.eq("creatorId", a.creatorId).eq("dedupeKey", `partner-review:${row._id}`)).unique();
  if (!review || (review.surface !== "web" && !review.deliveredAt) || !review.body.includes(d.body) || !review.body.includes(d.recipient) || source.ts < review.ts) return { handled: true, text: "the exact review hasn’t reached your chat yet. please review it before approving." };
  if (d.status !== "draft" || d.channel !== "email" || d.approvalExpiresAt <= Date.now() || !d.sender || source.ts < d.createdAt) return { handled: true, text: "that review is no longer available to send. ask me for the current draft." };
  const { data: o } = await ownedOpportunity(ctx, a.creatorId, row.opportunityId);
  if (CLOSED.has(o.status) || (o.deadline && o.deadline <= Date.now())) return { handled: true, text: "that opportunity is closed or expired. nothing was sent." };
  const mailbox = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  if (!mailbox || mailbox.generation !== d.mailboxGeneration || mailbox.email !== d.sender) return { handled: true, text: "your email connection changed. please review a fresh draft." };
  if (!emailSendEnabled(creator)) return { handled: true, text: "email sending isn’t enabled yet. your draft is saved; nothing was sent." };
  // K1: a FIRST pitch waits for the weekday-morning window on their clock (when inboxes get read), unless "NOW".
  const now = Date.now();
  const sendAt = !d.threadId && !match[2] ? nextSendAt(now, creator.timezone) : now;
  await ctx.db.patch(row._id, { data: { ...d, status: "approved", approvedBy: source._id, ...(sendAt > now ? { sendAt } : {}) }, updatedAt: now });
  await event(ctx, a.creatorId, row.opportunityId, `approved:${row._id}`, "approved", `Exact revision ${d.revision} approved by ${source._id}${sendAt > now ? `; sends ${new Date(sendAt).toISOString()}` : ""}`);
  await ctx.scheduler.runAfter(Math.max(0, sendAt - now), internal.partnerships.delivery.send, { creatorId: a.creatorId, draftId: row._id });
  if (sendAt > now) return { handled: true, draftId: row._id, text: `approved. it goes out ${sendWhen(sendAt, creator.timezone)} your time, when inboxes actually get read. to send it right now instead, reply SEND ${d.approvalCode} NOW.` };
  return { handled: true, draftId: row._id, text: "approved. i’ll check the conversation once more before sending." };
} });

export const get = internalQuery({ args: { creatorId: v.id("creators"), draftId: v.id("partnershipDrafts") }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const row = await ctx.db.get(a.draftId) as Doc<"partnershipDrafts"> | null;
  if (!row || row.creatorId !== a.creatorId) throw new Error("Draft unavailable");
  return { row, opportunity: (await ownedOpportunity(ctx, a.creatorId, row.opportunityId)).row };
} });

/** What the send page shows, by its code: only the pitch itself, only while it's the live draft (14 days). */
export interface PublicDraft { brand: string; channel: "email" | "dm" | "application"; to: string; subject: string; body: string; answers: Array<{ label: string; answer: string }> }
export const publicDraft = query({
  args: { code: v.string() },
  handler: async (ctx, a): Promise<PublicDraft | null> => {
    if (!/^[a-f0-9]{24}$/.test(a.code)) return null;
    const row = await ctx.db.query("partnershipDrafts").withIndex("by_share_code", (q) => q.eq("shareCode", a.code)).unique();
    if (!row) return null;
    const d = Draft.safeParse(row.data);
    if (!d.success || !["draft", "sent", "approved"].includes(d.data.status) || Date.now() - d.data.createdAt > 14 * 86_400_000) return null;
    const opp = (await ctx.db.get(row.opportunityId)) as Doc<"partnershipOpportunities"> | null;
    const o = opp ? OpportunitySchema.safeParse(opp.data) : null;
    return { brand: o?.success ? o.data.brand : "", channel: d.data.channel, to: d.data.recipient, subject: d.data.subject, body: d.data.body, answers: d.data.answers ?? [] };
  },
});
