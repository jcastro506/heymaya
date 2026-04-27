---
name: maya-brand-deal-triager
version: 0.1.0-sprint3.5
description: Inbound brand-email triage. Classifies (real-deal / cold-pitch / spam / partnership / press), extracts offer + urgency, drafts 4 reply variants tuned to floor rate, surfaces a suggested counter. Invokes maya-contract-redflag for PDF attachments and maya-rate-calculator for rate-bearing emails.
when-to-use: Cron-driven from Brand email triage program (Composio Gmail webhook on inbound thread). Also invoked from the Deals screen when the creator forwards a brand email manually. Do NOT invoke for outbound drafts or non-brand emails.
plan-tier: pro+ (Starter has no Gmail in allowedProviders; manual deal entry only). Studio adds brand-context lookup via Apollo/Hunter.
thinking-budget: medium
---

## Calls

- `maya-rate-calculator` — suggested counter-rate
- `maya-contract-redflag` — PDF attachments, in parallel with classification
- `maya-voice-applier` — every reply variant before return
- `maya-citation-firewall` — mandatory on every reply variant + the suggestedRate
- `docx` (Anthropic) — if a `.docx` brief is attached (rare)


# maya-brand-deal-triager

## Purpose

The brand inbox is where creators leak time and lose money. Without
triage, every email is either (a) ignored for days while the brand
forgets about them or (b) replied to in a hurry without a rate floor
in mind. This skill turns the inbound stream into structured deal cards
with grounded counter-rates and 4 reply variants matched to the creator's
voice and posture.

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
  brandContextLookupEnabled: boolean;   // true on Studio (Apollo/Hunter)
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

If `connectedAccounts.autoSendThreshold` is set on the creator's Gmail
connection AND `parsedOffer.proposedValueUsd` is below the threshold, the
orchestrating action MAY auto-send the top-ranked variant after the
firewall + voice pass complete. The "top-ranked" variant is decided by
the orchestrating action (typically `firm` for known floor-clearing deals,
`pass` for sub-floor pitches), not by this skill — the skill returns all
four variants and lets the caller pick.

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

The skill itself is plan-aware via `brandContextLookupEnabled`. The
upstream gate is:

```ts
requireFeature(creator, (f) => f.gmailDealDeskEnabled, "brand-deal-triager", "pro");
```

Starter creators have no Gmail in their `allowedProviders`, so there is
no inbound to triage in the first place. This skill should never be
invoked for a Starter creator — and if it is (e.g. by a misrouted call),
the upstream gate throws `PlanGateError` before this skill runs.

## Examples

- `examples/real-deal-known-brand.json` — real-deal with explicit dollar
  offer from a known-brand domain.
- `examples/cold-pitch-no-rate.json` — generic cold pitch, no rate.
- `examples/spam-prize-promo.json` — adversarial spam example.
- `examples/contract-attached.json` — real-deal with PDF attached, invokes
  `maya-contract-redflag` in parallel.
