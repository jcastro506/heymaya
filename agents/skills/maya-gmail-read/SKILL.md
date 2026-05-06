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

## Purpose

`maya-brand-deal-triager` consumes a normalized thread shape, but the
upstream Convex action has to (a) compose a Gmail-search-syntax query
when it pulls active brand-deal threads on a cron, (b) flatten the raw
Composio response into something Maya can summarize without leaking the
whole inbox into a prompt, and (c) hold every claim Maya makes about a
thread to facts that actually appear in the thread body.

This skill bundles those three jobs as pure-logic primitives. No model
calls live here. The Convex action wires the model spend; this script
gives the action the deterministic scaffolds.

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

## Triggers

- Cron `brand-deal-active-pull` (daily, Pro+) — calls `searchThreads`
  with the query from `buildSearchQuery({ intent: "brand-deal-active" })`
- Composio webhook → `maya-brand-deal-triager` — the triager fetches
  the full thread, calls `summarizeThread` to render the deal-card
  preview, and feeds `extractDealSignals` into its rule layer
- Chat-side "triage this for me" path — the creator pastes a thread
  reference; the action calls `summarizeThread` for the chat preview

## Heuristic phrases (deal signals)

Deterministic, case-insensitive substring checks against `bodyText`:

- `partnership`, `partner with`
- `campaign`, `campaign brief`
- `collab`, `collaboration`
- `rate`, `rate card`, `your rates`
- `we'd love to`, `would love to work with`
- `usage rights`, `whitelisting`, `paid amplification`
- `deliverable`, `deliverables`
- explicit `$NN` with at least 3 digits OR `Nk` shorthand

Maya's downstream skill is allowed to read these signals as evidence,
not as a verdict. The verdict lives in `maya-brand-deal-triager`.

## Citation rule

The thread body, the subject line, the from-header, and the receivedMs
are the only facts Maya may cite from this skill's output. Anything
else (rate comparables, niche fit, the creator's history) must come
from another skill's citation set. The firewall above is the
mechanical enforcement.

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
