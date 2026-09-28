import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { dayKeyInZone } from "../core/cadence";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { active, event, ownedOpportunity, profile } from "./store";
import { CLOSED, Draft, Opportunity, email, line, followUpEligible, nextFollowUpAt, spentWithoutReply, applicationCheckIn, APPLICATION_CHECK_IN_DAYS, type DraftData } from "./contracts";
import { access, gmail } from "./mailbox";
import { disclosureLine } from "./pitch";
import { deliverNow } from "../core/scheduler";
import { emailSendEnabled } from "./providerConfig";
import { faultFetch, faultFor } from "../eval/faults";

export function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function mime(d: DraftData, id: string): string {
  const sender = email.parse(d.sender), to = email.parse(d.recipient);
  const messageId = `<maya-${id}@${sender.split("@")[1]}>`;
  const chunks: string[] = []; let chunk = "";
  for (const char of line.parse(d.subject)) {
    if (new TextEncoder().encode(chunk + char).length > 42) { chunks.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  const subject = chunks.map(c => `=?UTF-8?B?${btoa(Array.from(new TextEncoder().encode(c), b => String.fromCharCode(b)).join(""))}?=`).join("\r\n ");
  const headers = [`From: ${sender}`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${messageId}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"];
  if (d.inReplyTo) { const ref = line.parse(d.inReplyTo); if (!/^<[^<>\s]+>$/.test(ref)) throw new Error("Invalid reply reference"); headers.push(`In-Reply-To: ${ref}`, `References: ${ref}`); }
  const body = btoa(Array.from(new TextEncoder().encode(d.body), b => String.fromCharCode(b)).join("")).match(/.{1,76}/g)?.join("\r\n") ?? "";
  return base64url(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

export const claim = internalMutation({ args: { creatorId: v.id("creators"), draftId: v.id("partnershipDrafts"), generation: v.string() }, handler: async (ctx, a) => {
  const creator = await active(ctx, a.creatorId);
  if (!emailSendEnabled(creator) || (await profile(ctx, a.creatorId)).data.paused) return false;
  const row = await ctx.db.get(a.draftId) as Doc<"partnershipDrafts"> | null;
  if (!row || row.creatorId !== a.creatorId) return false;
  const d = Draft.parse(row.data), now = Date.now();
  const mailbox = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  if (!mailbox) return false;
  const { data: o } = await ownedOpportunity(ctx, a.creatorId, row.opportunityId);
  if (d.status !== "approved" || !d.approvedBy || d.approvalExpiresAt <= now || d.mailboxGeneration !== mailbox?.generation || a.generation !== mailbox.generation || d.sender !== mailbox.email || d.recipient !== o.contactEmail || CLOSED.has(o.status) || (o.deadline && o.deadline <= now) || (o.lastInboundAt && o.lastInboundAt >= d.createdAt)) return false;
  await ctx.db.patch(row._id, { data: { ...d, status: "sending" }, updatedAt: now });
  return true;
} });
export const finish = internalMutation({ args: { creatorId: v.id("creators"), draftId: v.id("partnershipDrafts"), result: v.union(v.literal("sent"), v.literal("unknown"), v.literal("failed")), providerMessageId: v.optional(v.string()), threadId: v.optional(v.string()) }, handler: async (ctx, a) => {
  const c = await ctx.db.get(a.creatorId) as Doc<"creators"> | null;
  if (!c || c.plan.status === "deleting") return;
  const row = await ctx.db.get(a.draftId) as Doc<"partnershipDrafts"> | null;
  if (!row || row.creatorId !== a.creatorId) return;
  const d = Draft.parse(row.data);
  if (!["sending", "unknown"].includes(d.status)) return;
  if (a.result === "sent" && (!a.providerMessageId || !a.threadId)) throw new Error("Provider receipt required");
  const now = Date.now();
  await ctx.db.patch(row._id, { data: { ...d, status: a.result, providerMessageId: a.providerMessageId }, updatedAt: now });
  await event(ctx, a.creatorId, row.opportunityId, `send:${row._id}:${a.result}`, a.result === "sent" ? "provider_accepted" : "send_unknown", a.result === "sent" ? `Provider accepted revision ${d.revision}; delivery is not guaranteed` : "Outcome uncertain. Do not resend automatically.");
  if (a.result === "sent") {
    const { data: o } = await ownedOpportunity(ctx, a.creatorId, row.opportunityId);
    const inboundAfterDraft = !!o.lastInboundAt && o.lastInboundAt >= d.createdAt;
    // A send into a thread already contacted, with no reply since, is a follow-up (§8.3).
    const isFollowUp = o.status === "contacted" && !!o.lastOutboundAt && (!o.lastInboundAt || o.lastInboundAt < o.lastOutboundAt);
    await ctx.db.patch(row.opportunityId, { data: Opportunity.parse({ ...o, status: CLOSED.has(o.status) || inboundAfterDraft ? o.status : "contacted", threadId: a.threadId, mailboxGeneration: d.mailboxGeneration, lastMessageId: inboundAfterDraft ? o.lastMessageId : `<maya-${row._id}@${email.parse(d.sender).split("@")[1]}>`, lastOutboundAt: now, followUpBasis: "no_reply", followUpCount: isFollowUp ? (o.followUpCount ?? 0) + 1 : (o.followUpCount ?? 0), followUpAt: inboundAfterDraft || CLOSED.has(o.status) ? undefined : nextFollowUpAt(isFollowUp ? (o.followUpCount ?? 0) + 1 : (o.followUpCount ?? 0), now) }), updatedAt: now });
  }
} });
export const send = internalAction({ args: { creatorId: v.id("creators"), draftId: v.id("partnershipDrafts") }, handler: async (ctx, a) => {
  const r = await ctx.runQuery(internal.partnerships.drafts.get, a);
  const d = Draft.parse(r.row.data);
  if (d.status !== "approved") return;
  // K1: a pitch that waited for the morning is re-checked: closed, paused or expired since the approval sends nothing.
  const o = Opportunity.parse(r.opportunity.data);
  if (CLOSED.has(o.status) || (o.deadline && o.deadline <= Date.now())) return;
  if ((await ctx.runQuery(internal.partnerships.store.read, { creatorId: a.creatorId })).profile?.paused) return;
  const mailbox = await ctx.runQuery(internal.partnerships.mailbox.get, { creatorId: a.creatorId });
  if (!mailbox || mailbox.generation !== d.mailboxGeneration) return;
  // Everything that can fail before the network send happens before taking the send claim.
  let token: string, raw: string;
  try {
    token = await access(ctx, mailbox);
    raw = mime(d, a.draftId);
    if (d.threadId) await ctx.runAction(internal.partnerships.delivery.sync, { creatorId: a.creatorId, opportunityId: r.row.opportunityId });
  } catch {
    await ctx.runMutation(internal.partnerships.mailbox.attention, { creatorId: a.creatorId, generation: mailbox.generation, failed: true });
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: "i couldn’t finish checking your email, so i haven’t sent this pitch. your draft is saved. i’ll retry the check while your approval is still current.", dedupeKey: `partner-preflight:${a.draftId}`, proactive: false, kind: "reply" });
    return;
  }
  if (!await ctx.runMutation(internal.partnerships.delivery.claim, { ...a, generation: mailbox.generation })) return;
  let accepted = false;
  try {
    const fault = await faultFor(ctx, a.creatorId, "gmail"); // outage drill; null in production
    const response = await gmail(token, "messages/send", { raw, ...(d.threadId ? { threadId: d.threadId } : {}) }, fault ? faultFetch(fault) : undefined);
    if (typeof response.id !== "string" || typeof response.threadId !== "string") throw new Error("Missing provider receipt");
    await ctx.runMutation(internal.partnerships.delivery.finish, { ...a, result: "sent", providerMessageId: response.id, threadId: response.threadId });
    accepted = true;
  } catch {
    // A timeout or 5xx can happen AFTER acceptance. Never blindly retry a send.
    await ctx.runMutation(internal.partnerships.delivery.finish, { ...a, result: "unknown" });
  }
  await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: accepted ? "your email was accepted by your email provider. i’ll keep track of replies." : "i couldn’t confirm whether that email went through. i’m checking before trying anything else.", dedupeKey: `partner-send-result:${a.draftId}`, proactive: false, kind: "reply" });
  await deliverNow(ctx as never);
} });

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
function textPart(p: Part, depth = 0): string {
  if (depth > 8) return "";
  if (p.mimeType === "text/plain" && p.body?.data) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(p.body.data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))).slice(0, 12000); } catch { return ""; }
  }
  return (p.parts ?? []).slice(0, 20).map(c => textPart(c, depth + 1)).join("\n").slice(0, 12000);
}
export const ingest = internalMutation({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities"), generation: v.string(), messages: v.array(v.object({ id: v.string(), at: v.number(), text: v.string(), inbound: v.boolean(), messageId: v.optional(v.string()) })) }, handler: async (ctx, a) => {
  await active(ctx, a.creatorId);
  const mailbox = await ctx.db.query("partnershipMailboxes").withIndex("by_creator", q => q.eq("creatorId", a.creatorId)).unique();
  const { row, data: o } = await ownedOpportunity(ctx, a.creatorId, a.opportunityId);
  if (mailbox?.generation !== a.generation || o.mailboxGeneration !== a.generation) return { added: 0 };
  let added = 0, latest = o.lastInboundAt ?? 0, lastMessageId = o.lastMessageId;
  let suppressed = o.status === "suppressed";
  for (const m of a.messages.slice(0, 100).sort((x, y) => x.at - y.at)) {
    if (!m.inbound) continue;
    if (/\b(unsubscribe|do not (?:email|contact|message)|don['’]t (?:email|contact|message)|remove (?:me|us) from|stop (?:emailing|contacting|messaging)|address not found|undeliverable|delivery status notification \(failure\))\b/i.test(m.text)) suppressed = true;
    if (await event(ctx, a.creatorId, row._id, `gmail:${a.generation}:${m.id}`, "email_received_untrusted", m.text, m.at)) added++;
    if (m.at >= latest) { latest = m.at; lastMessageId = m.messageId; }
  }
  if (latest > (o.lastInboundAt ?? 0) || (suppressed && o.status !== "suppressed")) {
    await ctx.db.patch(row._id, { data: Opportunity.parse({ ...o, lastInboundAt: latest, lastMessageId, status: suppressed ? "suppressed" : CLOSED.has(o.status) ? o.status : "replied", followUpAt: undefined }), updatedAt: Date.now() });
    for (const draft of await ctx.db.query("partnershipDrafts").withIndex("by_opportunity", q => q.eq("opportunityId", row._id)).collect()) {
      const d = Draft.parse(draft.data);
      if (["draft", "approved"].includes(d.status) && latest >= d.createdAt) await ctx.db.patch(draft._id, { data: { ...d, status: "canceled" }, updatedAt: Date.now() });
    }
  }
  return { added };
} });
export const sync = internalAction({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") }, handler: async (ctx, a): Promise<unknown> => {
  const result = await ctx.runQuery(internal.partnerships.store.read, a);
  if (!("opportunity" in result) || !result.opportunity) return { added: 0 };
  const o = Opportunity.parse(result.opportunity.data);
  if (!o.threadId) return { added: 0, reason: "No tracked email thread; manual handoff status is unknown until the user reports it." };
  const mailbox = await ctx.runQuery(internal.partnerships.mailbox.get, { creatorId: a.creatorId });
  if (!mailbox || mailbox.generation !== o.mailboxGeneration) throw new Error("Reconnect the original mailbox before checking this conversation");
  const response = await gmail(await access(ctx, mailbox), `threads/${encodeURIComponent(o.threadId)}?format=full`);
  await ctx.runMutation(internal.partnerships.mailbox.attention, { creatorId: a.creatorId, generation: mailbox.generation, failed: false });
  const messages = (response.messages ?? []) as Array<{ id: string; internalDate: string; labelIds?: string[]; snippet?: string; payload?: Part & { headers?: Array<{ name: string; value: string }> } }>;
  return await ctx.runMutation(internal.partnerships.delivery.ingest, { ...a, generation: mailbox.generation, messages: messages.slice(-100).map(m => ({ id: m.id, at: Math.min(Date.now(), Number(m.internalDate) || Date.now()), text: (m.payload ? textPart(m.payload) : "") || m.snippet || "Message received; body unavailable", inbound: !(m.labelIds ?? []).some(l => l === "SENT" || l === "DRAFT"), messageId: m.payload?.headers?.find(h => h.name.toLowerCase() === "message-id")?.value })) });
} });
export const page = internalQuery({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, a) => await ctx.db.query("partnershipOpportunities").paginate({ cursor: a.cursor, numItems: 25 }) });
export const poll = internalAction({ args: { cursor: v.optional(v.string()) }, handler: async (ctx, a) => {
  const page = await ctx.runQuery(internal.partnerships.delivery.page, { cursor: a.cursor ?? null });
  for (const row of page.page) {
    const o = Opportunity.parse(row.data);
    if (CLOSED.has(o.status)) continue;
    await ctx.scheduler.runAfter(0, internal.partnerships.delivery.checkOne, { creatorId: row.creatorId, opportunityId: row._id });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(1000, internal.partnerships.delivery.poll, { cursor: page.continueCursor });
} });

export const checkOne = internalAction({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") }, handler: async (ctx, a) => {
    try {
      const overview = await ctx.runQuery(internal.partnerships.store.read, { creatorId: a.creatorId });
      if (overview.profile?.paused) return;
      await ctx.runAction(internal.partnerships.delivery.reconcile, a);
      await ctx.runAction(internal.partnerships.delivery.sync, a);
      const fresh = await ctx.runQuery(internal.partnerships.store.read, a);
      if (!fresh.opportunity) return;
      const data = Opportunity.parse(fresh.opportunity.data);
      if (CLOSED.has(data.status)) return;
      // §8.3: three touches and no reply closes it, once, and it's never contacted again unless they ask.
      if (spentWithoutReply(data, Date.now())) {
        await ctx.runMutation(internal.partnerships.delivery.closeNoResponse, { creatorId: a.creatorId, opportunityId: a.opportunityId });
        return;
      }
      const rails = await ctx.runQuery(internal.scout.gate.railsOnly, { creatorId: a.creatorId, now: Date.now() });
      if (!rails?.ok) return;
      const unansweredReply = !!data.lastInboundAt && data.lastInboundAt >= (data.lastOutboundAt ?? 0);
      const candidates: Array<{ key: string; body: string }> = [];
      if (unansweredReply) candidates.push({ key: `partner-reply:${a.opportunityId}:${data.lastInboundAt}`, body: `${data.brand}’s email conversation has a new message. want to look at it together?` });
      for (const item of data.deliverables) if (item.status === "agreed" && item.dueAt <= Date.now() + 86400000) candidates.push({ key: `partner-deliverable:${a.opportunityId}:${item.title}:${item.dueAt}`, body: `${item.title} for ${data.brand} ${item.dueAt < Date.now() ? "is past its recorded due date" : "is due within the next day"}. how’s it coming along? when it goes up, ${disclosureLine(data.brand)}.` });
      if (data.deadline && data.deadline > Date.now() && data.deadline <= Date.now() + 2 * 86400000 && ["discovered", "shortlisted"].includes(data.status)) candidates.push({ key: `partner-deadline:${a.opportunityId}:${data.deadline}`, body: `${data.brand}’s opportunity closes within two days, according to the saved program details. want to review it together?` });
      // §8.3 applications: one "did you get to submit it?", then (after they did) one "heard back?".
      const check = applicationCheckIn(data, Date.now());
      if (check === "submit") candidates.push({ key: `partner-app-submit:${a.opportunityId}`, body: `did you get to submit the ${data.brand} application? tell me when you have, and i'll check back in a couple of weeks.` });
      if (check === "heard_back") candidates.push({ key: `partner-app-heard:${a.opportunityId}`, body: `heard anything back from ${data.brand} about your application?` });
      if (followUpEligible(data, Date.now())) candidates.push({ key: `partner-followup:${a.opportunityId}:${data.followUpAt}`, body: data.followUpBasis === "user_requested" ? `you asked me to revisit ${data.brand} around now. want to work out the next step?` : `we haven’t received a reply from ${data.brand} in the tracked email conversation. want me to prepare a follow-up for you to review?` });
      // K1: the brand opened their per-brand kit link: said once, and only a statement (nothing to answer).
      const opened = await ctx.runQuery(internal.partnerships.kitSettings.openedUntold, { creatorId: a.creatorId, opportunityId: a.opportunityId });
      if (opened) candidates.push({ key: `partner-kit-open:${opened.id}`, body: `${data.brand} opened your media kit. nothing to do yet, just good to know.` });
      // §8.3: one partnerships nudge a day across all their brands; the rest wait for tomorrow.
      if (candidates.length && await ctx.runQuery(internal.partnerships.delivery.nudgedToday, { creatorId: a.creatorId })) return;
      for (const candidate of candidates) {
        if (await ctx.runQuery(internal.core.messages.exists, { creatorId: a.creatorId, dedupeKey: candidate.key })) continue;
        const kitOpen = candidate.key.startsWith("partner-kit-open:");
        await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: candidate.body, dedupeKey: candidate.key, proactive: true, kind: "partnership", awaitingAnswer: !kitOpen });
        if (candidate.key.startsWith("partner-app-")) await ctx.runMutation(internal.partnerships.delivery.countCheckIn, { creatorId: a.creatorId, opportunityId: a.opportunityId });
        if (kitOpen && opened) await ctx.runMutation(internal.partnerships.kitSettings.markOpenedTold, { id: opened.id });
        break; // One useful interruption, respecting the existing cadence rails.
      }
    } catch {
      const mailbox = await ctx.runQuery(internal.partnerships.mailbox.get, { creatorId: a.creatorId });
      if (mailbox) await ctx.runMutation(internal.partnerships.mailbox.attention, { creatorId: a.creatorId, generation: mailbox.generation, failed: true });
    }
} });

// Searching the deterministic RFC Message-ID reconciles ambiguous sends without sending again.
export const reconcile = internalAction({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") }, handler: async (ctx, a) => {
  const r = await ctx.runQuery(internal.partnerships.store.read, a);
  const mailbox = await ctx.runQuery(internal.partnerships.mailbox.get, { creatorId: a.creatorId });
  if (!mailbox || !r.drafts) return;
  for (const row of r.drafts) {
    const d = Draft.parse(row.data);
    if (d.status === "approved" && d.approvalExpiresAt > Date.now() && d.mailboxGeneration === mailbox.generation) {
      await ctx.scheduler.runAfter(0, internal.partnerships.delivery.send, { creatorId: a.creatorId, draftId: row._id });
      continue;
    }
    if (!["unknown", "sending"].includes(d.status) || row.updatedAt > Date.now() - 60000 || d.mailboxGeneration !== mailbox.generation) continue;
    const token = await access(ctx, mailbox);
    const query = `in:sent rfc822msgid:maya-${row._id}@${email.parse(d.sender).split("@")[1]}`;
    const found = await gmail(token, `messages?maxResults=2&q=${encodeURIComponent(query)}`);
    const messages = found.messages as Array<{ id: string; threadId: string }> | undefined;
    if (messages?.length === 1) await ctx.runMutation(internal.partnerships.delivery.finish, { creatorId: a.creatorId, draftId: row._id, result: "sent", providerMessageId: messages[0].id, threadId: messages[0].threadId });
    else if (d.status === "sending") await ctx.runMutation(internal.partnerships.delivery.finish, { creatorId: a.creatorId, draftId: row._id, result: "unknown" });
    // Search misses are not proof of failure. Keep unknown for manual review.
  }
} });

/** §8.3: after the last follow-up with no reply, the relationship closes as no response; they hear once. */
export const closeNoResponse = internalMutation({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") }, handler: async (ctx, a) => {
  const { data: o } = await ownedOpportunity(ctx, a.creatorId, a.opportunityId);
  if (!spentWithoutReply(o, Date.now())) return;
  await ctx.db.patch(a.opportunityId, { data: Opportunity.parse({ ...o, status: "closed", closedReason: "no_response", followUpAt: undefined }), updatedAt: Date.now() });
  await event(ctx, a.creatorId, a.opportunityId, `closed:no_response:${a.opportunityId}`, "closed", "No reply after three touches; closed as no response.");
  await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: `no word from ${o.brand} after three tries, so i've closed that one. say the word if you ever want to try them again.`, dedupeKey: `partner-closed:${a.opportunityId}`, proactive: true, kind: "partnership" });
} });

/** An application check-in went out: count it (at most one per stage). */
export const countCheckIn = internalMutation({ args: { creatorId: v.id("creators"), opportunityId: v.id("partnershipOpportunities") }, handler: async (ctx, a) => {
  const { data: o } = await ownedOpportunity(ctx, a.creatorId, a.opportunityId);
  await ctx.db.patch(a.opportunityId, { data: Opportunity.parse({ ...o, applicationCheckIns: (o.applicationCheckIns ?? 0) + 1, applicationCheckInAt: undefined }), updatedAt: Date.now() });
} });

/** They submitted the application (the app's button, or they told her): one check-in in two weeks. */
export async function markApplied(ctx: MutationCtx, creatorId: Doc<"creators">["_id"], opportunityId: Doc<"partnershipOpportunities">["_id"]): Promise<void> {
  const { data: o } = await ownedOpportunity(ctx, creatorId, opportunityId);
  if (o.appliedAt || CLOSED.has(o.status)) return;
  const now = Date.now();
  await ctx.db.patch(opportunityId, { data: Opportunity.parse({ ...o, status: "contacted", appliedAt: now, applicationCheckIns: 1, applicationCheckInAt: now + APPLICATION_CHECK_IN_DAYS.afterSubmit * 86_400_000 }), updatedAt: now });
  await event(ctx, creatorId, opportunityId, `applied:${opportunityId}`, "applied", "They submitted the application (their report).");
}

/** Has a partnerships nudge already gone out today, on their clock? */
export const nudgedToday = internalQuery({ args: { creatorId: v.id("creators") }, handler: async (ctx, a): Promise<boolean> => {
  const c = await ctx.db.get(a.creatorId) as Doc<"creators"> | null;
  if (!c) return true;
  const today = dayKeyInZone(Date.now(), c.timezone);
  const rows = await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", Date.now() - 36 * 3_600_000)).collect() as Doc<"messages">[];
  return rows.some((m) => m.direction === "out" && m.kind === "partnership" && m.proactive && dayKeyInZone(m.ts, c.timezone) === today);
} });
