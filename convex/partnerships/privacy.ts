import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { Draft, Opportunity } from "./contracts";

/** Erase derived prose while retaining minimal operational suppression/send receipts.
 * Forgetting must not let a later retry cold-pitch a brand again.
 */
export async function forgetPartnershipEvidence(ctx: MutationCtx, creatorId: Id<"creators">, excluded: Set<Id<"messages">>, needles: string[]) {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const matches = (s: string) => needles.some(n => normalize(s).includes(n));
  const profiles = await ctx.db.query("partnershipProfiles").withIndex("by_creator", q => q.eq("creatorId", creatorId)).collect();
  for (const p of profiles) if (matches(JSON.stringify(p.data))) await ctx.db.patch(p._id, { data: { paused: true }, updatedAt: Date.now() });
  for (const row of await ctx.db.query("partnershipOpportunities").withIndex("by_creator", q => q.eq("creatorId", creatorId)).collect()) {
    const o = Opportunity.parse(row.data);
    if (!o.assessment.creatorEvidence.some(e => excluded.has(e.id as Id<"messages">)) && !matches(JSON.stringify(o))) continue;
    // Keep source IDs as tombstones; erase quotes and derived fit. Fresh research and a fresh review are required.
    const redacted = "Forgotten; ask for fresh evidence before making a recommendation.";
    await ctx.db.patch(row._id, { data: { ...o, fit: redacted, unknowns: [redacted], assessment: { verdict: "investigate", goalAlignment: redacted, contentAlignment: redacted, audienceFit: redacted, commercialFit: redacted, concerns: ["Previous personal evidence was forgotten"], creatorEvidence: o.assessment.creatorEvidence.map(e => ({ ...e, quote: "[forgotten]", reason: "[forgotten]" })) }, deliverables: [], followUpAt: undefined }, updatedAt: Date.now() });
  }
  for (const row of await ctx.db.query("partnershipDrafts").withIndex("by_creator", q => q.eq("creatorId", creatorId)).collect()) {
    const d = Draft.parse(row.data);
    // Pending consent is invalidated on every memory deletion. Sent receipts survive without matching prose.
    await ctx.db.patch(row._id, { data: { ...d, ...(["draft", "approved"].includes(d.status) ? { status: "canceled" } : {}), ...(matches(`${d.subject} ${d.body}`) ? { subject: "[forgotten]", body: "[forgotten]" } : {}) }, updatedAt: Date.now() });
  }
  for (const e of await ctx.db.query("partnershipEvents").withIndex("by_creator", q => q.eq("creatorId", creatorId)).collect()) if (matches(e.text)) await ctx.db.patch(e._id, { text: "[forgotten]" });
}
