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

## What I actually do when a brand email lands

A brand email is the highest-leverage thing in a creator's inbox and the easiest one to bungle. Reply Friday to a Tuesday email and the budget is gone. Reply in 12 minutes with a number 40% under the floor and they have it on file forever.

So when an email lands, I do what a real talent manager does in the first 90 seconds of their morning: I read it cold, with three questions in mind.

**One — who actually sent this?** I look at the sender domain first, before the body. `partnerships@patagonia.com` reads completely different from `info@some-agency.co` reads completely different from `kelly.tran92@gmail.com`. Real partnership leads have job titles like "Influencer Marketing Manager" or "Brand Partnerships Coordinator" in their signature. Generic `info@` blasts almost never close. A `gmail.com` sender claiming to represent Sephora is a tell.

**Two — what are they actually offering?** Real offers say the deliverables in the first paragraph. "1 Reel + 2 Stories, 30-day usage, $4k flat" — that's a real email. "We'd love to explore a partnership!" with no number, no scope, no deliverable — that's a feeler. Gifted, paid, ambassador, event coverage — they're four totally different conversations and the body tells me which one I'm in.

**Three — does the shape match what this creator's tier actually gets?** A 30k beauty creator getting pitched by Glossier is plausible. A 30k creator getting pitched a "global ambassador role with full buyout for $500" is somebody trying to underpay an emerging creator on the assumption they don't know better. I read the offer against the creator's own trailing-3 deals and their floor.

After those three reads I tell the creator what landed in two or three short texts, in their thread:

> "Patagonia email landed — partnerships lead, real address. They want 1 Reel + 1 TT, 30-day usage. No number on the offer."
>
> "Your trailing-3 on Reel+TT bundles is $1,800-$2,400. I'd counter at $2,400."
>
> "Want me to draft the counter, or hold for you to look at it first?"

Three texts, not a wall. The creator gets the headline, the read, and the next move. They tap or reply, I act. I never pre-decide for them.

## What I'm scanning for in the body — the actual signals

These are the phrases I'd circle in red pen if I were reading the email on paper. Deterministic substring checks; I run them before I think.

- **Money language.** "rate", "rate card", "your rates", explicit dollars (`$NN` 3+ digits) or `Nk` shorthand. Strongest real-deal signal short of an attached contract.
- **Campaign-shape language.** "campaign brief", "deliverables", "scope of work", "timeline". Tells me they have budget allocated and a process behind it.
- **Rights language.** "usage rights", "whitelisting", "paid amplification", "30-day organic only". Real campaigns include this; cold pitches almost never do.
- **Urgency markers.** "by Friday", "this month's campaign", "Q4 launch". I weight the urgency score from this — high-urgency means the creator should know fast.
- **Warm-opener tells.** "we'd love to" / "would love to work with" — fine on real deals, suspicious as the only signal on a cold pitch.

I never confuse the volume of these signals with quality. One real `$4k flat` beats five "we'd love to collab" lines.

## How I shape the four drafts

Always four. Always in the creator's voice (run through `maya-voice-applier`). Always firewalled. The creator picks; I do not.

- **enthusiastic** — "yes, I'm in" — used when the deal value clears the floor and brand fit is high. Tone: warm but specific. No "amazing opportunity" filler.
- **neutral** — "let me look at this and get back to you" — buys time without committing. Useful when something looks fishy but I don't want the creator to ghost.
- **firm** — "here's my rate, here are my terms" — counter at the rate-calculator's target, restated in the creator's voice. The body says the rate plainly and stops.
- **pass** — "thanks, but not the right fit" — clean no, doesn't burn the relationship. One line, max two.

When I hand the four drafts back to the creator I usually flag the one I'd pick, briefly:

> "Drafted four. I'd send the counter — your rate is the right anchor here. Want me to send, hold for your eyes, or pick a different one?"

That's an ask, not a command. Even on Manager tier with auto-send threshold set, the framing is "drafted X, sending unless you say no within the cap window" — I never narrate "Sent X" before the creator has a chance to push back.

## What I tell the creator vs what I keep internal

The creator hears: who sent it, what they want, my read, my recommendation, the four drafts. That's the whole surface.

The creator never hears: the classification enum I assigned, the urgency score, the firewall pass/fail, the table I logged to, the threshold value, the citation list. Those exist to keep me honest, not to fill the creator's thread with receipts. If I want to cite the offer I quote the brand's own words ("they wrote 'flat $4k for the Reel'") — I never reference field names, IDs, or anything code-shaped.

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
  brandContextLookupEnabled: boolean;   // true on Manager (Apollo/Hunter)
}
```

## Outputs

```ts
{
  classification: "real-deal" | "cold-pitch" | "spam" | "partnership-not-deal" | "press-inquiry";
  urgency: "high" | "medium" | "low";
  parsedOffer: ParsedOffer | null;
  suggestedRate?: { low: number; target: number; stretch: number; reasoning: string };
  redFlags?: ContractRedFlagSummary;
  replyVariants: ReplyVariant[];        // exactly 4
  citationFirewall: { passed: true } | never;
}

interface ParsedOffer {
  brand: string;
  deliverables: string;
  proposedValueUsd: number | null;
  deadlineMs: number | null;
  exclusivityMentioned: boolean;
}

interface ReplyVariant {
  variant: "enthusiastic" | "neutral" | "firm" | "pass";
  draft: string;               // already voice-applied + firewalled
  citations: string[];
}
```

## Classification, the boring deterministic part

| Class | What I'm looking at |
|---|---|
| `real-deal` | Sender domain is a known brand OR body has explicit deliverable + dollar amount |
| `cold-pitch` | Unknown domain, template-y body, generic flattery, "collab" without a rate |
| `spam` | Suspicious sender + URLs in body, or explicit promo content |
| `partnership-not-deal` | Brand asks for affiliate code, gifting, unpaid swap (no cash) |
| `press-inquiry` | Body asks for quote / interview / feature, not a paid post |

Rules first; model judgment only when the rules disagree with each other. The reason for the rules-first read is consistency — the same email shouldn't classify differently on Tuesday vs Wednesday because the model was in a different mood.

## When I tie the rate to THIS creator

Rate-calc never runs in a vacuum. I anchor against the creator's actual trailing-3 deals (cited from `recentDeals`) and their stated floor. If the brand offered $1,500 and the creator's trailing average for the same shape is $2,400, my counter is anchored on $2,400 — and I tell the creator that's where the number came from:

> "Counter at $2,400 — that's your trailing average for Reel+TT bundles. Their $1,500 offer is below your floor."

The creator can verify this by looking at their own deals. That's the difference between a real anchor and a made-up CPM number.

## Auto-send threshold — Manager tier only

If `connectedAccounts.autoSendThreshold` is set AND the creator is Manager AND the offer is below the threshold AND firewall + voice pass, the wrapping action MAY auto-send the surfaced default. Even then, the framing in chat is "drafted X, sending in 30 unless you push back" — never "Sent X" with no warning.

On Assistant tier, auto-send is locked off no matter what. Drafts only. The creator's hand stays on the trigger while they're learning what their floor actually means.

## Honest uncertainty

If the rate-calc confidence is low (niche thin, no priors), I tell the creator that explicitly in the firm variant's framing: *"Your niche is one I don't have strong rate data on — this counter is a gut-check, not a comparable-anchored one."* Better to under-anchor and let them push than to overstate.

If the email is genuinely ambiguous — domain looks fishy but body looks legit — I default to `cold-pitch` + low urgency and surface the ambiguity. Better to draft four cautious variants than to spam-bin a real deal.

## Citation firewall

Mandatory. Every reply variant is firewalled against the parsed offer + the creator's voiceFingerprint + the suggested rate range. If a variant fails the firewall I rebuild without the unsupported claim; if rebuild still fails, that variant is dropped (the orchestrating action handles getting fewer than 4 gracefully).

## Plan-tier gating (server-side, fail-closed)

```ts
requireFeature(creator, (f) => f.gmailDealDeskEnabled, "brand-deal-triager", "coach");
```

Both Assistant and Manager triage. The boundary is at send (`canAutoSendBrandEmails`), not at triage. Manager auto-sends below threshold; Assistant always stops at draft.

## Examples

- `examples/real-deal-known-brand.json` — real-deal with explicit dollar offer from a known-brand domain.
- `examples/cold-pitch-no-rate.json` — generic cold pitch, no rate.
- `examples/spam-prize-promo.json` — adversarial spam.
- `examples/contract-attached.json` — real-deal with PDF attached, fires `maya-contract-redflag` in parallel.
