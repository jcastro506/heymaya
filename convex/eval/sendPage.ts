/**
 * Dev only: plants one pitch draft with a send-page code on a creator, so the /m/<code> page can be looked at in
 * a browser without running the deals world. Internal (CLI only); refuses unless the creator is an eval persona.
 */
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";
import { Draft, Opportunity } from "../partnerships/contracts";

export const plantDraft = internalMutation({
  args: { creatorId: v.id("creators"), channel: v.union(v.literal("email"), v.literal("dm"), v.literal("application")) },
  handler: async (ctx, a): Promise<{ code: string }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !/^eval/.test(c.clerkUserId)) throw new Error("eval personas only");
    const now = Date.now();
    const o = Opportunity.parse({
      brand: "Tracksmith", campaign: "creator program", type: "ugc", fit: "running content, honest tone", unknowns: [],
      assessment: { verdict: "recommend", goalAlignment: "paid work", contentAlignment: "running", audienceFit: "runners", commercialFit: "UGC budget", concerns: [], creatorEvidence: [{ kind: "post", id: "p1", quote: "morning run", reason: "their best format" }] },
      eligibility: "open", compensation: "paid", route: a.channel === "email" ? "email" : a.channel === "dm" ? "dm" : "application",
      ...(a.channel === "email" ? { contactEmail: "creators@tracksmith.com" } : { routeUrl: a.channel === "dm" ? "https://www.instagram.com/tracksmith/" : "https://www.tracksmith.com/creators" }),
      applicationFields: a.channel === "application" ? [{ label: "Why do you want to work with us?", required: true, type: "text", sourceUrl: "https://www.tracksmith.com/creators" }] : [],
      evidence: [{ url: "https://www.tracksmith.com/creators", excerpt: "creator program", checkedAt: now, kind: "search" }],
    });
    const opp = await ctx.db.insert("partnershipOpportunities", { creatorId: c._id, brandDomain: "tracksmith.com", data: o, updatedAt: now });
    const code = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const body = "hey Tracksmith team,\n\ni make running videos for people who run before work: the 5am run nobody sees, honest about the hard days. my morning routine posts are my best, around 1.2K views on a normal one and up to 879K on the ones that travel.\n\ni'd love to make a few UGC videos of your gear in that same style, filmed on my real runs.\n\nmy media kit: https://staging.hey-maya.ai/k/246i6g5z4c0p1j2w071q\n\nwould you be open to a quick chat?\n\nvanessa";
    const d = Draft.parse({ revision: 1, channel: a.channel, subject: "Tracksmith x early-morning runs", body, recipient: a.channel === "email" ? "creators@tracksmith.com" : (o.routeUrl as string), status: "draft", approvalCode: "x", approvalExpiresAt: now + 86_400_000, createdAt: now, ...(a.channel === "application" ? { answers: [{ label: "Why do you want to work with us?", answer: "your gear is what i actually run in at 5am, and my audience is people who run before work." }] } : {}) });
    await ctx.db.insert("partnershipDrafts", { creatorId: c._id, opportunityId: opp, data: d, updatedAt: now, shareCode: code });
    return { code };
  },
});
