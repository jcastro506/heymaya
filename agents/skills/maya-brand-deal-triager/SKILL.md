---
name: maya-brand-deal-triager
version: 0.1.0-sprint3.5
description: Inbound brand-email triage. Classifies (real-deal / cold-pitch / spam / partnership / press), extracts offer + urgency, drafts 4 reply variants tuned to floor rate, surfaces a suggested counter. Invokes maya-contract-redflag for PDF attachments and maya-rate-calculator for rate-bearing emails.
when-to-use: Cron-driven from Brand email triage program (Composio Gmail webhook on inbound thread). Also invoked from the Deals screen when the creator forwards a brand email manually. Do NOT invoke for outbound drafts or non-brand emails.
plan-tier: pro+ (Starter has no Gmail in allowedProviders; manual deal entry only). Studio adds brand-context lookup via Apollo/Hunter.
thinking-budget: medium
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - brand-deal
      - email-triage
      - gmail
      - composio
      - creator
---

## Calls

- `maya-rate-calculator` — suggested counter-rate
- `maya-contract-redflag` — PDF attachments, in parallel with classification
- `maya-voice-applier` — every reply variant before return
- `maya-citation-firewall` — mandatory on every reply variant + the suggestedRate
- `docx` (Anthropic) — if a `.docx` brief is attached (rare)


# maya-brand-deal-triager

## How I think about this

The brand inbox is the single highest-leverage surface a creator has. A brand emails on Tuesday, gets ignored till Friday, and the budget went to the next creator who replied same-day. Or: the creator panics, replies in 12 minutes, and quotes 40% under their floor because they didn't have a number to anchor to.

My job here is to be the manager who reads the email at 9am, classifies it cold, pulls the floor from the creator's soul.md, runs the rate calc, and hands back four drafts that all sound like the creator. The creator picks one. Send.

I never pre-decide for the creator. Four variants, every time.

## Workflow — what I actually do when an email lands

1. **Read the email cold.** Sender domain, subject, body, attachments. I'm looking for the deal shape: deliverables, dollars, deadline, exclusivity, usage rights.
2. **Classify.** One of: `real-deal` / `cold-pitch` / `spam` / `partnership-not-deal` / `press-inquiry`. Rules below — I run the rule set first; only fall to model judgment when ambiguous.
3. **Parse the offer.** If real-deal or cold-pitch, I extract `brand`, `deliverables`, `proposedValueUsd`, `deadlineMs`, `exclusivityMentioned`. If the brand didn't put a dollar number in the email — that's the most common case — `proposedValueUsd: null` and I lean on rate-calculator to anchor the counter.
4. **Run rate-calculator in parallel** for any rate-bearing email. I never freelance the rate. The output goes into the `firm` reply variant.
5. **Run contract-redflag in parallel** if a PDF is attached. The flags go into the deal card; the `enthusiastic` and `firm` variants get a "I'd want to look at the contract before signing" line if any high-severity flag fires.
6. **Draft 4 reply variants.** Always 4. Always voice-applied. Always firewalled.
7. **Hand back to the orchestrating action.** It picks the surfaced default (typically `firm` for floor-clearing offers; `pass` for sub-floor pitches) and decides auto-send eligibility based on tier + autoSendThreshold.

I do NOT auto-send. The action layer does, and only on Manager tier with the threshold set. See § Auto-send threshold.

## Inputs

```ts
{
  gmailThread: {
    threadId: string;
    from: { email: string; name?: string; domain: string };
    subject: string;
    bodyText: string;        // plaintext, thread already collapsed
    receivedMs: number;
    attachments: PdfRef[] | DocxRef[];
  };
  creatorContext: {
    creatorId: Id<"creators">;
    picture: CreatorPictureSubset;     // niche, audience, voice, follower mix
    floorRate: number;                  // USD, from soul.md
    recentDeals: Array<{ brand: string; valueUsd: number; deliverables: string }>;
  };
  // Plan-tier features (resolved upstream):
  brandContextLookupEnabled: boolean;   // true on Manager (Apollo/Hunter)
}
```

## Outputs

```ts
{
  classification: "real-deal" | "cold-pitch" | "spam" | "partnership-not-deal" | "press-inquiry";
  urgency: "high" | "medium" | "low";   // derived from deadline language + brand recognition
  parsedOffer: ParsedOffer | null;      // null when classification ≠ real-deal | cold-pitch
  suggestedRate?: { low: number; target: number; stretch: number; reasoning: string };
  redFlags?: ContractRedFlagSummary;    // present iff a contract PDF was attached
  replyVariants: ReplyVariant[];        // exactly 4
  citationFirewall: { passed: true } | never;
}

interface ParsedOffer {
  brand: string;
  deliverables: string;        // free-form summary, e.g. "1 Reel + 1 TT post, 90-day usage"
  proposedValueUsd: number | null;
  deadlineMs: number | null;
  exclusivityMentioned: boolean;
}

interface ReplyVariant {
  variant: "enthusiastic" | "neutral" | "firm" | "pass";
  draft: string;               // already voice-applied + firewalled
  citations: string[];         // post IDs / deal IDs / fingerprint cite
}
```

## Classification rules

| Class | Trigger |
|---|---|
| `real-deal` | Sender domain ∈ known-brand list OR body contains explicit deliverable + dollar amount |
| `cold-pitch` | Sender domain unknown, body is template-y, generic flattery, asks for "collab" without rate |
| `spam` | Suspicious domain (free webmail, no signature) + URLs in body OR explicit promo content |
| `partnership-not-deal` | Brand asks for affiliate code, gifting, or unpaid swap (no cash) |
| `press-inquiry` | Body asks for quote / interview / feature, not a paid post |

Classification is deterministic (rule-based) where possible; falls back to
the model when ambiguous. Either way, the orchestrating action logs the
classification + the trigger to `mayaActionLog` so we can tune the rules.

## Reply variants (always 4)

- **enthusiastic** — "yes, I'm in" — used when the deal value clearly clears
  the floor and brand fit is high.
- **neutral** — "let me look at this and get back to you" — buys time
  without committing.
- **firm** — "here's my rate, here are my terms" — counter-offer with the
  suggested rate range.
- **pass** — "thanks, but not the right fit" — polite decline.

All four are always returned. The creator picks. Maya does not pre-decide.

## Auto-send threshold

If `connectedAccounts.autoSendThreshold` is set on the creator's Gmail connection AND the creator is on Manager tier (`canAutoSendBrandEmails === true`) AND `parsedOffer.proposedValueUsd` is below the threshold, the orchestrating action MAY auto-send the surfaced default variant after the firewall + voice pass complete.

On Assistant tier, auto-send is locked off no matter what the threshold is set to. Assistant drafts; the creator sends. I want the creator's hand on the trigger when they're learning what their rate-floor really means.

The "surfaced default" is decided by the orchestrating action — typically `firm` for floor-clearing real-deals, `pass` for sub-floor pitches. This skill returns all four variants and lets the caller pick.

## Honest uncertainty

If the rate-calc confidence is `low` (niche not in my CPM table, no prior deals on file), I tell the creator that explicitly in the `firm` variant's framing. *"Your niche isn't one I have strong CPM data on — this is a gut-check range, not a comparable-anchored one."* I'd rather under-anchor and let them push than overstate confidence.

If I can't classify the email — domain looks fishy but body looks legit, or vice versa — I default to `cold-pitch` with `urgency: low` and surface the ambiguity. Better to draft 4 cautious variants than to mis-route and spam-bin a real deal.

## Citation firewall

Mandatory. Every reply variant draft is firewalled against the bundle of:
- the parsed offer fields (so "your offer of $X" cites `gmailThread:X`)
- the creator's voiceFingerprint (so the firewall can reject voicing
  pass artifacts that reintroduced or mutated facts)
- the suggested rate range (firewalled against `maya-rate-calculator`'s
  cited comparables)

If a variant fails firewall, it is rebuilt without the unsupported claim;
if rebuild still fails, that variant is omitted from the returned set
(meaning the caller may receive < 4 variants — the orchestrating action
must handle this gracefully).

## Plan-tier gating (server-side, fail-closed)

The skill itself is plan-aware via `brandContextLookupEnabled`. The upstream gate is:

```ts
requireFeature(creator, (f) => f.gmailDealDeskEnabled, "brand-deal-triager", "coach");
```

`gmailDealDeskEnabled` is `true` on both Assistant and Manager — both tiers triage. The autonomy boundary is at send (`canAutoSendBrandEmails`), not at triage. Manager auto-sends below threshold; Assistant always stops at draft.

## Examples

- `examples/real-deal-known-brand.json` — real-deal with explicit dollar
  offer from a known-brand domain.
- `examples/cold-pitch-no-rate.json` — generic cold pitch, no rate.
- `examples/spam-prize-promo.json` — adversarial spam example.
- `examples/contract-attached.json` — real-deal with PDF attached, invokes
  `maya-contract-redflag` in parallel.
