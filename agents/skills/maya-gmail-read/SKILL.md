---
name: maya-gmail-read
version: 0.1.0-sprint7-slice-a
description: Pure-logic Gmail read helpers used by the brand-deal triager. Composes Gmail-search-syntax queries, summarizes a fetched thread without leaving evidence, extracts deterministic deal signals, and runs a citation firewall that constrains Maya to facts present in the thread body.
when-to-use: Called by maya-brand-deal-triager (event-driven from the Composio Gmail webhook) and by chat-side flows when the creator forwards a thread for triage. Do NOT use for outbound writes — see maya-gmail-draft for that. This skill never sends or modifies email; it only reads.
plan-tier: pro+ (Starter has no Gmail in allowedProviders; manual deal entry only)
thinking-budget: none (deterministic) — this script is pure logic; the upstream classification + drafting steps own the model spend
metadata:
  openclaw:
    emoji: "📥"
    tags:
      - email
      - gmail
      - read
      - creator
---

# maya-gmail-read

## What I actually do when I open the creator's inbox

I'm the read half of the brand-deal desk. When the creator's Gmail fires (cron pull every morning, or a webhook on a fresh thread), I do what a real talent manager does the first 90 seconds of their workday — I skim the inbox, looking for the four or five threads that actually matter, and I leave the noise alone.

The way an assistant skims:

- **Sender domain first, before the body.** `partnerships@patagonia.com` reads completely different from `info@some-agency.co` reads completely different from a Gmail address claiming to represent Sephora. The domain tells me 80% of what I need before I read a word.
- **Display name second.** Real partnership leads have job titles like "Influencer Marketing Manager" or "Brand Partnerships Coordinator" or "Creator Marketing" in their signatures. A generic "info" or no display name at all is a tell.
- **Subject line third.** "Partnership opportunity" + "campaign brief" + "rate card" patterns are the loud signals. "Quick question about your content" is the cold-template signal. "Final notice" or "URGENT" is the spam signal.
- **First paragraph fourth.** A real brand opens with the deliverable. A cold pitch opens with flattery. A spam pitch opens with a URL.
- **Dollar amounts and dates.** $5k, 30-day usage rights, deadline next Friday — these are the signals the triager downstream needs to build a deal card. If they're in the body, I capture them literally; if they're not, I do not invent them.
- **Anything dormant >30 days.** Old threads where someone from a brand replied once and the creator never followed up. Most creators ghost their own warm leads — these are gold for outreach.

I am NOT making the real-deal / cold / spam call. That's `maya-brand-deal-triager`. I'm the deterministic scaffolding underneath it: compose the right Gmail-search query, flatten the response into something the triager can read without leaking the entire inbox into its prompt, hold every downstream claim to facts that actually appear in the thread body, the subject, or the from-header.

No model calls live here. I'm pure logic. The triager wires the model spend; I hand back citation-safe scaffolds.

## What I tell the creator vs what I keep internal

When I surface a brand thread to the creator, I cite what they can verify themselves: the brand name, the subject line, the offer in the body. The creator can pull up Gmail and confirm.

I never reference internal data shapes — no field names, no thread IDs, no "Convex storage" surfaces. The creator hears: *"Patagonia just emailed — partnerships lead, real address, asking about Q1 campaign."* Not: *"Thread 18a3f surfaced from gmailThread.from.email partnerships@patagonia.com."*

## Inputs

```ts
buildSearchQuery({
  creatorId: string;
  intent: "brand-deal-active" | "brand-deal-archive" | "general";
  sinceMs?: number;             // optional explicit cutoff
}): string

summarizeThread(thread: GmailThread): {
  summary: string;              // ≤280 chars, neutral, plain
  lastSenderEmail: string;
  subjectLine: string;
  senderDomain: string;
  firstParagraph: string;       // ≤400 chars, clipped at sentence boundary
}

extractDealSignals(thread: GmailThread): {
  isLikelyBrandDeal: boolean;
  signals: string[];            // matched evidence phrases
}

citationFirewall(claim: string, thread: GmailThread): { ok: boolean }
```

`GmailThread` shape matches what `maya-brand-deal-triager` already takes
(`from.email`, `from.name?`, `from.domain`, `subject`, `bodyText`,
`receivedMs`, `attachments[]`, `threadId`). We re-export the type from
this skill to keep the call sites import-stable.

## Outputs

`buildSearchQuery` returns Gmail-search-syntax. The convention:

| intent | query |
|---|---|
| `brand-deal-active` | `is:unread newer_than:7d (partnership OR campaign OR collab OR rate)` |
| `brand-deal-archive` | `(partnership OR campaign OR collab OR brand) -in:spam newer_than:90d` |
| `general` | `newer_than:30d -category:promotions -category:social` |

`sinceMs`, when supplied, replaces `newer_than:Xd` with the closest
day-bucket equivalent (7 / 14 / 30 / 90 days). We round to day-buckets
because Gmail-search-syntax does not accept arbitrary timestamps.

`summarizeThread` returns a deterministic summary. No model is called —
the summary is built from the subject + the first paragraph + the
sender domain. This is the surface Maya cites when she tells the
creator "subject line + who sent it" without claiming anything she
hasn't read.

`extractDealSignals` looks for the matched-phrase set documented under
"Heuristic phrases" below. The boolean is intentionally a flag, not a
classification — Maya's downstream skill (`maya-brand-deal-triager`)
makes the actual real-deal / cold-pitch / spam call. This skill only
returns the evidence list it would point to.

`citationFirewall` returns `{ ok: true }` only when every numeric
substring + every quoted phrase + every named entity inside `claim`
appears (case-insensitively) inside `thread.bodyText`, the subject
line, or the from-header (display name + email + domain). If a claim
cites a number Maya didn't pull from the thread, this returns
`{ ok: false }` and the calling skill is expected to drop the claim or
restate it as a question to the creator.

## Cadence — when I run

I am NOT a heartbeat skill and I am NOT proactive on my own. I run on three triggers, all event-driven:

- **Daily cron pull (Pro+ only).** `brand-deal-active-pull` fires once a morning to find anything from the last 7 days that smells like a partnership thread. I compose the search query and hand the results to the triager. Cron exists so a brand email that landed at 11pm and was buried by overnight noise still surfaces in the morning brief.
- **Composio webhook on inbound.** When a fresh email lands in the connected inbox, Composio pings the triager; the triager calls me to flatten the raw thread into the citation-safe summary it renders on the deal card.
- **Chat-side "triage this for me."** The creator forwards a thread reference in iMessage. The Convex action calls `summarizeThread` for the chat preview before the triager classifies.

I do not poll. I do not run on heartbeat. I do not pull mail Maya hasn't been asked to look at.

## What I'm scanning for in the body — the deal signals

Deterministic, case-insensitive substring checks against `bodyText`. These are the phrases I'd circle in red pen if I were reading the email on paper:

- **Relationship-shape language** — `partnership`, `partner with`, `collab`, `collaboration`. Tells me this isn't a press inquiry.
- **Campaign-shape language** — `campaign`, `campaign brief`, `deliverable`, `deliverables`. Tells me they have a brief, which means they have budget allocated.
- **Money language** — `rate`, `rate card`, `your rates`, plus explicit `$NN` (3+ digits) or `Nk` shorthand. This is the strongest real-deal signal short of a contract attachment.
- **Rights language** — `usage rights`, `whitelisting`, `paid amplification`. Big-brand campaigns include this; cold pitches almost never do.
- **Warm-opener language** — `we'd love to`, `would love to work with`. Genuine on real deals; a tell on cold pitches when there's nothing else.

I return the matched-phrase list, NOT a verdict. The verdict — real-deal vs cold-pitch vs spam — lives one skill downstream in `maya-brand-deal-triager`. I'm the evidence; the triager is the jury.

## Citation rule — what Maya is allowed to claim from my output

The thread body, the subject line, the from-header (display name + email + domain), and `receivedMs` are the ONLY facts Maya may cite from anything I return. If the brand wrote "$5k for a Reel + IG carousel" in the body, Maya can quote it. If Maya wants to say "your last brand deal was $4k so this is a $1k bump," that's a different claim that needs a `deal` citation from the brand-deal history — not from me.

Anything else — rate comparables, niche fit, the creator's posting history — must come from another skill's citation set. My firewall above is the mechanical enforcement: a claim that cites a number not present in the thread comes back `{ ok: false }` and the calling skill drops the claim or restates it as a question to the creator.

Hand-off chain when I run: cron / webhook → me (`buildSearchQuery` + `summarizeThread` + `extractDealSignals`) → `maya-brand-deal-triager` (classification + reply variants) → `maya-citation-firewall` (final gate).

## Plan-tier (server-side, fail-closed)

The upstream gate is:

```ts
requireFeature(creator, (f) => f.gmailDealDeskEnabled, "gmail-read", "pro");
```

Starter creators have no Gmail in their `allowedProviders`, so there is
no inbound to summarize in the first place. This skill should never be
invoked for a Starter creator — and if it is (e.g. by a misrouted
call), the upstream gate throws `PlanGateError` before this skill runs.

## What this skill does NOT do

- Does NOT call any Gmail action. The Convex action layer wraps
  `convex/integrations/composio/actions/gmail.ts` (`searchThreads`,
  `getThread`); this skill just composes the search query and
  flattens the result the action handed back.
- Does NOT classify a thread as real-deal / cold-pitch / spam — that's
  `maya-brand-deal-triager`'s job. This skill returns evidence.
- Does NOT generate prose. The summary is deterministic; the deal-card
  copy lives in the HQ Deals screen.

## Sibling files

- Consumed by: `maya-brand-deal-triager/script.ts` (input shape match)
- Inventory entry: `agents/skills/maya-platform/skill.md`
- Convex tables touched (read-only): `connectedAccounts` (for the
  Composio account id) — accessed via the calling action, not this
  script
- Pairs with: `maya-gmail-draft` (the write half of the email surface)
