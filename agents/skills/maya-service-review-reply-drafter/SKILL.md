---
name: maya-service-review-reply-drafter
version: 0.1.0-sprint3
description: Draft a GBP review reply that passes Google's `ReviewReplyState` moderation. NEVER auto-published — operator approves every reply at all tiers.
when-to-use: Fired by the `review_reply` standing order on Pub/Sub `NEW_REVIEW` (or Zernio webhook fallback) within 30 min. Also from chat when operator manually requests a draft.
plan-tier: all (operator approval required at all tiers — locked across Starter/Pro/Studio per Google moderation requirements; `business.approvalRules.review-reply-auto-publish-allowlist` is FORBIDDEN at all tiers, server-side enforced).
model-routing: Gemini 3 Flash, MEDIUM thinking. Per § 3 routing matrix — reasoning quality matters; Google moderation bar to clear.
---

# maya-service-review-reply-drafter

## Purpose

Review replies are public, permanent, and visible to every future customer. A bad reply (defensive, robotic, generic) tanks trust faster than the original review did. A good reply turns a 3-star into a 5-star "they made it right" arc.

Maya drafts; operator approves; operator publishes. **Locked across all tiers.** Google's `ReviewReplyState` rejects AI-generated replies without operator approval; the lock is both a moderation requirement AND a quality guarantee.

## Inputs

```ts
{
  reviewBody: string;                    // raw review text
  reviewerName: string;                  // displayed name
  starRating: 1 | 2 | 3 | 4 | 5;
  brandVoice: string;                    // from businessPicture.brandVoice
  jobContext?: {                         // matched serviceJobs row, if customer matched
    jobId: string;
    serviceType: string;
    technicianName: string | null;
    completedAt: number;
    notes: string;
  };
  operatorFirstName: string;
}
```

## Outputs

```ts
{
  replyText: string;                     // ≤350 chars (GBP soft cap)
  sentiment: "positive" | "neutral" | "negative";
  riskFlags: Array<                      // operator-only triggers
    | "extortion-language"
    | "profanity"
    | "competitor-name-drop"
    | "personal-info-leak"
    | "legal-threat"
  >;
  citationContext: {
    matchedJob: string | null;           // jobReference if jobContext present
    grounded: boolean;
  };
}
```

## Drafting rules

- **5-star, technician-named:** thank by name, mention what was done specifically, sign off in operator's voice.
- **5-star, generic:** thank, brief acknowledgment, no upsell.
- **3-4 star:** acknowledge the gap, no defensive language, offer to make it right via private channel ("please call us"), never argue specifics in public.
- **1-2 star without risk flags:** empathy first, "I'd like to make it right," operator-callback CTA.
- **1-2 star WITH risk flags (`extortion-language`, `legal-threat`):** flag for operator-only handling. Return a placeholder `replyText` that says "[operator: this review needs your direct handling — risk flags: ...]" and DO NOT auto-promote past approval.

## Hard rules

- Never auto-post. Output is always `reviews.draftReply`; publish requires `replyStatus='approved'` set by operator.
- Never name a competitor in a reply.
- Never quote prices in a reply.
- Never imply liability. ("Sorry the leak happened" not "sorry our work caused the leak.")
- Never dispute facts publicly. Move dispute conversations offline.
- Citation: if `jobContext` present, the reply may reference the service type and technician. If absent, generic acknowledgment only — never invent job details to feel personal.

## Memory-wiki integration (§ 9.5)

- **Pre-send**: when `jobContext` is present and the reply mentions "this customer's prior interactions" / "as we discussed last time" / any across-job continuity claim, call `wiki_get("entities/customers/<lastname-firstinitial>")` and verify the page exists with non-empty evidence. If the page is missing or the claim isn't supported, the firewall (which always runs after this skill) will fail; pre-emptively rewrite to job-only context.
- **Post-draft (non-blocking)**: emit a `wiki_apply` to `sources/reviews/<external-id>` recording the inbound review text + reviewer name + star rating + `jobContext.jobId` (if present) as a source page. Provenance: `{ sourceId: "zernio:gbp-review:<id>", path: "$.body" }`. This lets future drafts cite this review when the same customer reviews again.
- Tool calls inherit this skill's MEDIUM-thinking routing for the LLM-driven draft step itself; `wiki_get`/`wiki_apply` are direct plugin calls (no thinking budget consumed).

## Plan-tier

All tiers. The lock is permanent — Google moderation reasons + product quality reasons.

## Model routing

Gemini 3 Flash, MEDIUM thinking. Per § 3 routing matrix — review replies are public, permanent, multi-stakeholder (customer + future customers + Google moderation), so the medium-thinking budget is justified.

## Test categories

1. **Cross-tenant** — Business A's reviews never matched against Business B's `serviceJobs`.
2. **Plan-tier** — `review-reply-auto-publish-allowlist` rule type rejected at all tiers including Studio. Server-side fail-closed.
3. **Adversarial** — extortion language detected + flagged. Profanity in review → flagged not echoed. Prompt-injection in review body → ignored.
4. **Citation** — `jobContext.serviceType` referenced ONLY when `jobContext` is present; `matchedJob` is `null` when absent.
5. **Google moderation pass simulation** — replies don't promise specifics that violate `ReviewReplyState` (e.g. exact discounts, "5-star guarantee").

## Sibling files

- Standing order: `review_reply` (event-driven) — defined in `convex/agents/packs/maya-service/standingOrders.ts`.
- Calls: `maya-service-citation-firewall` (mandatory pre-send), `maya-service-brand-voice-applier`.
- Convex tables: writes `reviews.draftReply` + `reviews.replyStatus='drafted'`; reads `serviceJobs` + `businessPicture` + `serviceCustomers` for jobContext matching.

## ~~GBP Q&A reply — folded into this skill (Wave C.6)~~ — REMOVED 2026-04-27

The Wave C.6 fold-in of GBP Q&A drafting into this skill has been removed. Per Zernio's [Google Business Profile docs](https://docs.zernio.com/platforms/google-business) verbatim: "Respond to Q&A (deprecated by Google, replaced by AI-powered 'Ask Maps')." The GBP Q&A API is **gone at Google level**, not just unavailable in Zernio's wrapper. There's nothing for Maya to subscribe to via webhooks (no `NEW_QUESTION` event) and nothing for her to reply to via the API.

Confirmed via the Zernio capability audit — see `docs/spikes/zernio-capability-audit.md`. The previously-imagined `maya-service-gbp-seo-auditor` "answer-q-and-a" nudge type is also dropped — Maya cannot answer Q&A through the API, so generating a nudge to do so would just frustrate the operator.

If Google ever resurrects the Q&A API (or surfaces an "Ask Maps" alternative the API can interact with), this fold-in design would be the place to restart from.
