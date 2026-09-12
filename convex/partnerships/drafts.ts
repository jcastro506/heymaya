import { v } from "convex/values";
import { z } from "zod";
import { internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { active, event, ownedOpportunity, profile, assertPersonalEvidence } from "./store";
import { CLOSED, Draft, email, line } from "./contracts";
import { checkPlainLanguage } from "../core/plainLanguage";

export const prepare = internalMutation({
  args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages"), input: v.any() },
  handler: async (ctx, a): Promise<unknown> => {
    const c = await active(ctx, a.creatorId);
    const source = await ctx.db.get(a.sourceMessageId) as Doc<"messages"> | null;
    if (!source || source.creatorId !== a.creatorId || source.direction !== "in") throw new Error("User message required");
    if ((await profile(ctx, a.creatorId)).data.paused) throw new Error("Partnerships are paused");
    const input = z.object({ opportunityId: z.string(), subject: line, body: z.string().trim().min(1).max(12000) }).strict().parse(a.input);
    const { row, data: o } = await ownedOpportunity(ctx, a.creatorId, input.opportunityId as Id<"partnershipOpportunities">);
    const now = Date.now();
    if (CLOSED.has(o.status) || (o.deadline && o.deadline <= now) || o.route === "unknown") throw new Error("No actionable outreach route");
    if (o.assessment.verdict === "pass") throw new Error("This brand was assessed as unsuitable; revisit the assessment first");
    await assertPersonalEvidence(ctx, a.creatorId, o);
    if (o.evidence.every(e => e.checkedAt < now - 7 * 86400000)) throw new Error("Research is stale; refresh the opportunity before drafting");
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
    if (recent.filter(d => d._creationTime >= monthStart).length >= 30) throw new Error("Monthly draft allowance reached");
    for (const d of drafts) {
      const old = Draft.parse(d.data);
      if (["draft", "approved"].includes(old.status)) await ctx.db.patch(d._id, { data: { ...old, status: "canceled" }, updatedAt: now });
    }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
    const data = Draft.parse({ revision: drafts.length + 1, channel: o.route, subject: input.subject, body: input.body, recipient, sender: mailbox?.email, mailboxGeneration: mailbox?.generation, threadId: o.threadId, inReplyTo: o.lastMessageId, status: "draft", approvalCode: code, approvalExpiresAt: now + 86400000, createdAt: now });
    const id = await ctx.db.insert("partnershipDrafts", { creatorId: a.creatorId, opportunityId: row._id, data, updatedAt: now });
    await event(ctx, a.creatorId, row._id, `draft:${id}`, "draft_created", `Revision ${data.revision}; ${data.channel}; ${recipient}`);
    const command = `SEND ${code}`;
    const body = o.route === "email"
      ? `here’s the email to review.\n\nFrom: ${mailbox?.email ?? "Connect your email first"}\nTo: ${recipient}\nSubject: ${data.subject}\n\n${data.body}\n\n${mailbox ? `To send exactly this email, reply ${command}. This expires in 24 hours. Changes need a new review.` : "This is a draft only. Connect your Gmail account before approving a new draft."}`
      : `${o.route === "application" ? "here are your draft application answers. review and submit them yourself" : "here’s a DM you can send"}:\n${recipient}\n\n${data.body}\n\nlet me know once you’ve sent it so i can keep track.`;
    if (!checkPlainLanguage(body).ok) throw new Error("The review would be altered by the chat formatter. Rephrase the draft before requesting approval.");
    // Exact approval display is authored by code, never rephrased by the model.
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, body, surface: c.channel.paired ? "telegram" : "web", dedupeKey: `partner-review:${id}`, proactive: false, kind: "reply" });
    return { draftId: id, revision: data.revision, status: "draft", reviewQueued: true, instruction: "The exact review is queued separately. Do not repeat it or say it was sent to the brand." };
  },
});

export const approve = internalMutation({ args: { creatorId: v.id("creators"), sourceMessageId: v.id("messages") }, handler: async (ctx, a): Promise<{ handled: boolean; text?: string; draftId?: Id<"partnershipDrafts"> }> => {
  const source = await ctx.db.get(a.sourceMessageId) as Doc<"messages"> | null;
  if (!source || source.creatorId !== a.creatorId || source.direction !== "in" || source.memoryExcludedAt || source.fileId || source.fileMime || (source.kind && source.kind !== "inbound")) return { handled: false };
  const match = /^SEND ([a-f0-9]{24})$/i.exec(source.body.trim());
  if (!match) return { handled: false };
  await active(ctx, a.creatorId);
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
  if (process.env.PARTNERSHIP_EMAIL_SEND_ENABLED !== "true") return { handled: true, text: "email sending isn’t enabled yet. your draft is saved; nothing was sent." };
  await ctx.db.patch(row._id, { data: { ...d, status: "approved", approvedBy: source._id }, updatedAt: Date.now() });
  await event(ctx, a.creatorId, row.opportunityId, `approved:${row._id}`, "approved", `Exact revision ${d.revision} approved by ${source._id}`);
  await ctx.scheduler.runAfter(0, internal.partnerships.delivery.send, { creatorId: a.creatorId, draftId: row._id });
  return { handled: true, draftId: row._id, text: "approved. i’ll check the conversation once more before sending." };
} });

export const get = internalQuery({ args: { creatorId: v.id("creators"), draftId: v.id("partnershipDrafts") }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const row = await ctx.db.get(a.draftId) as Doc<"partnershipDrafts"> | null;
  if (!row || row.creatorId !== a.creatorId) throw new Error("Draft unavailable");
  return { row, opportunity: (await ownedOpportunity(ctx, a.creatorId, row.opportunityId)).row };
} });
