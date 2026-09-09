/** Evidence-linked personal history. Helpers stay inside the caller's transaction. */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MESSAGE_DAYS } from "../core/retention";
import { styleFacts } from "./voice";
import { splitEvents } from "../taste/separation";

export const normalizeMemory = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function recordVisible(ctx: QueryCtx, r: Doc<"personalRecords">, creatorId: Id<"creators">): Promise<boolean> {
  if (r.creatorId !== creatorId || !r.active) return false;
  for (const id of r.sourceMessageIds) {
    const m = await ctx.db.get(id);
    if (!m || m.creatorId !== creatorId || m.memoryExcludedAt || m.ts < Date.now() - MESSAGE_DAYS * 86_400_000) return false;
  }
  for (const id of r.sourcePostIds) { const p = await ctx.db.get(id); if (!p || p.creatorId !== creatorId) return false; }
  if (r.sourceNoteIds.length) {
    const c = await ctx.db.get(creatorId);
    if (!c || r.sourceNoteIds.some((id) => !c.notes.some((n) => n.id === id && !n.tombstonedAt && (!n.expiresHint || n.expiresHint > Date.now())))) return false;
  }
  return true;
}

/** Dated, deterministic snapshots. No invented visual or personality claims. */
export async function captureStyle(ctx: MutationCtx, creatorId: Id<"creators">, now = Date.now()) {
  const posts = await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(200);
  const end = now;
  const start = now - 30 * 86_400_000;
  const sample = posts.filter((p) => p.createTime >= start && p.createTime <= end).sort((a, b) => a.createTime - b.createTime);
  if (sample.length < 5) return;
  const key = `style:${Math.floor(now / (7 * 86_400_000))}`;
  const existing = await ctx.db.query("personalRecords").withIndex("by_creator_key", (q) => q.eq("creatorId", creatorId).eq("key", key)).first();
  // One frozen snapshot per week; changes later in the week appear in the next snapshot.
  if (existing) return;
  const facts = styleFacts(sample.map((p) => p.caption), sample.map((p) => p.hashtags.length));
  const examples = [sample[0], sample[Math.floor(sample.length / 2)], sample[sample.length - 1]];
  const reads = await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(200);
  const text = examples.map((p) => {
    const card = reads.find((r) => r.ownPostId === p._id)?.card as { signature?: string; them?: { humor?: string } } | undefined;
    return `${new Date(p.createTime).toISOString().slice(0, 10)}: “${p.caption.slice(0, 120)}” [post ${p._id}]${card?.signature ? `; observed: ${card.signature.slice(0, 180)}` : ""}${card?.them?.humor ? `; humour observed: ${card.them.humor.slice(0, 120)}` : ""}`;
  }).join("\n");
  await ctx.db.insert("personalRecords", { creatorId, key, kind: "style", text, sourceMessageIds: [], sourceNoteIds: [], sourcePostIds: sample.map((p) => p._id), facts, periodStart: start, periodEnd: end, active: true, at: now });
}

export async function personalHistoryFor(ctx: QueryCtx, creatorId: Id<"creators">): Promise<string> {
  const records = await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).order("desc").take(80);
  const live: Doc<"personalRecords">[] = [];
  for (const record of records) if (await recordVisible(ctx, record, creatorId)) live.push(record);
  const current = live.filter((r) => r.kind !== "style").slice(0, 8);
  const lines: string[] = [];
  for (const r of current) {
    let state = r.kind === "commitment" ? "discussed; no linked scheduled action" : "creator's words";
    if (r.blockId) {
      const block = await ctx.db.get(r.blockId);
      if (block?.creatorId === creatorId) state = block.status === "deleted" ? "cancelled" : block.filmedAt ? "filmed (recorded)" : block.consentAt ? `booked for ${new Date(block.start).toISOString()}` : "proposed, not booked";
    }
    lines.push(`- ${new Date(r.at).toISOString().slice(0, 10)} [${r.kind}; ${state}; source ${r.sourceMessageIds.join(",")}] ${r.text}${r.reason ? ` — reason: ${r.reason}` : ""}`);
  }
  const styleRows = await ctx.db.query("personalRecords").withIndex("by_creator_kind", (q) => q.eq("creatorId", creatorId).eq("kind", "style")).order("desc").take(12);
  const styles: Doc<"personalRecords">[] = [];
  for (const row of styleRows) if (row.facts && await recordVisible(ctx, row, creatorId)) styles.push(row);
  styles.sort((a, b) => a.at - b.at);
  if (styles.length) {
    const latest = styles[styles.length - 1];
    // Compare non-overlapping observation windows, not two near-identical weekly samples.
    const previous = styles.findLast((s) => (s.periodEnd ?? s.at) <= (latest.periodStart ?? latest.at));
    for (const s of previous ? [previous, latest] : [latest]) lines.push(`- Style observed ${new Date(s.periodStart ?? s.at).toISOString().slice(0, 10)} to ${new Date(s.periodEnd ?? s.at).toISOString().slice(0, 10)}: ${JSON.stringify(s.facts)}\n${s.text}`);
  }
  return lines.length ? `# Personal history and style over time\n${lines.join("\n")}\nReasons are user evidence, not a license to generalize. Effort is not dislike. Compare dated samples before claiming a change. A commitment without a linked action is not scheduled. Follow up naturally only when relevant; never claim a reminder exists without an action record.` : "";
}

/** Invalidate descendants, repeated verbatim sources, and untraceable legacy summaries.
 * Operational calendar records remain authoritative; forgetting is not cancellation.
 */
export async function forgetEvidence(ctx: MutationCtx, creator: Doc<"creators">, note: Doc<"creators">["notes"][number]) {
  const now = Date.now();
  const source = note.sourceMessageId ? await ctx.db.get(note.sourceMessageId) : null;
  const needles = [note.text, source?.creatorId === creator._id ? source.body : ""].map(normalizeMemory).filter((s) => s.length >= 8);
  const messages = await ctx.db.query("messages").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect();
  const excluded = new Set<Id<"messages">>();
  for (const m of messages) {
    const matches = m._id === note.sourceMessageId || needles.some((n) => normalizeMemory(m.body).includes(n));
    if (matches || m.dedupeKey === `reply:${note.sourceMessageId}`) { await ctx.db.patch(m._id, { memoryExcludedAt: now }); excluded.add(m._id); }
  }
  const records = await ctx.db.query("personalRecords").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect();
  for (const r of records) if (r.sourceNoteIds.includes(note.id) || r.sourceMessageIds.some((id) => excluded.has(id)) || needles.some((n) => normalizeMemory(`${r.text} ${r.reason ?? ""}`).includes(n))) await ctx.db.patch(r._id, { active: false, invalidatedAt: now });
  const notes = creator.notes.map((n) => n.id === note.id || (n.sourceMessageId && excluded.has(n.sourceMessageId)) || needles.some((needle) => normalizeMemory(n.text).includes(needle)) ? { ...n, tombstonedAt: now } : n);
  const memories = await ctx.db.query("memories").withIndex("by_creator_ref", (q) => q.eq("creatorId", creator._id)).collect();
  for (const m of memories) if (notes.some((n) => n.id === m.refId && n.tombstonedAt) || needles.some((n) => normalizeMemory(m.text).includes(n))) await ctx.db.delete(m._id);
  const directives = await ctx.db.query("directives").withIndex("by_creator_and_active", (q) => q.eq("creatorId", creator._id).eq("active", true)).collect();
  for (const rule of directives) if ((rule.sourceMessageId && excluded.has(rule.sourceMessageId)) || needles.some((n) => normalizeMemory(rule.verbatim).includes(n))) await ctx.db.patch(rule._id, { active: false, supersededAt: now });
  const events = await ctx.db.query("tasteEvents").withIndex("by_creator", (q) => q.eq("creatorId", creator._id)).collect();
  const remaining = [];
  for (const event of events) {
    if (event.messageId && excluded.has(event.messageId)) await ctx.db.delete(event._id);
    else remaining.push(event);
  }
  const signals = splitEvents(remaining);
  await ctx.db.patch(creator._id, { notes, affinities: signals.preferences, performanceAffinities: signals.performance, signalsSeparatedAt: now, memoryEpoch: (creator.memoryEpoch ?? 0) + 1, dossier: undefined, dossierPrevious: undefined, dossierDiff: undefined, taste: undefined, growthPlan: undefined, updatedAt: now });
}
