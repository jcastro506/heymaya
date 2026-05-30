---
name: maya-inbound-triage
description: Reply / DM / mention triage. For every inbound to an owned post, classify (buyer / supporter / noise / hostile), draft a response if reply-worthy, and surface to the operator in one line — they should never have to scan their own inbox.
---

# maya-inbound-triage

## Purpose

The founder shouldn't be scrolling through Reddit comments or X notifications. Every inbound — reply to an owned post, DM, mention — gets classified by Maya and surfaced as a one-liner with an action. Operator decides yes/no/edit, Maya handles the rest.

## When to invoke

- Event-driven: a webhook (or polling worker, if no webhook is available for the platform) reports a new inbound. The webhook handler invokes this skill.
- On-demand: operator says "anything in my inbox?" → Maya checks last 24h owned-post engagement via scrape + triages.
- HEARTBEAT-COMPATIBLE — runs quickly, no expensive work.

## Pre-conditions

1. The inbound is a real reply / DM / mention (not Maya's own scheduled post).
2. The owned post the inbound is responding to (if any) is identifiable — `gtmPostResults` link or platform metadata.
3. `gtmBuyerMap.intentPhrases` is populated (used to classify "buyer" vs "supporter").

## Required reads

1. **APP.md** — what we sell + buyer pain.
2. **USER.md** — operator voice.
3. **GTM.md** — current strategy (informs what counts as "worth a reply").
4. **gtmBuyerMap** + **gtmRelationshipTargets** — is the inbound author a known relationship target? Promote.

## Classification (Maya's judgment)

Four buckets:

- **BUYER** — author exhibits buyer intent (asks "how does this work," "is this open source," "pricing?" — or echoes a `gtmBuyerMap.intentPhrases`). Draft a substantive reply that opens dialogue. High priority.
- **SUPPORTER** — author is friendly, in-ICP, but not buying right now. Adds value to the thread. Draft a thank-you that doesn't pitch. Medium priority. Often a `gtmRelationshipTargets` candidate — flag.
- **NOISE** — author is venting / off-topic / asking something Maya can't help with. No reply needed.
- **HOSTILE** — author is trolling or attacking. No reply unless it's gaining traction (in which case escalate to operator with "this one's getting upvoted — your call").

## Draft-response framework (for BUYER + SUPPORTER)

Drafted reply must:

- Lead with value, not the product. Address what they asked first.
- Cite specifics from the owned post (don't generalize).
- Be in operator's voice (slop-critic'd before surfacing).
- Include the product only if naturally relevant — never as a "thanks! check out [product]" tack-on.
- Match the platform's native length — long enough to be useful, short enough that it doesn't read as overcompensation.

For DMs that are buyer-intent, the draft can be longer + warmer + include a specific next-step (link, demo offer, calendar).

## Surfacing to operator

For each inbound, Maya sends ONE Telegram message (or batches if 3+ landed at once). Format:

```
[BUYER] @alice asked on Reddit thread X (link):
"Is this open source? I'd want to host my own."

Draft reply (your voice):
"Not open source — closed-source binary, $9/mo cloud. Self-host is on the roadmap for Q2 but it's behind the team-features work. What's your blocker — pricing or data sovereignty?"

Reply / edit / skip?
```

The operator types "reply" → Maya posts via `publish_draft({ draftId })`. "Edit" → Maya waits for the edited text. "Skip" → drop.

For SUPPORTERS the surface is lighter:

```
[SUPPORTER] @bob upvoted + replied "love this idea" on your X post (link). Worth a thank-you? Draft: "Thanks bob — DMed you the early-access link."
```

NOISE never gets surfaced (just logged in `gtmActionLog` for audit).
HOSTILE escalates only if it's gaining real traction in Maya's judgment (upvote velocity / quote-tweet count rising fast enough that ignoring it would be the wrong call).

## Relationship-target promotion

If a SUPPORTER author matches a `gtmRelationshipTargets` row → patch status to `warming` or `engaged`. If a previously-dropped target shows up again → revive to `prospect`.

If a SUPPORTER is NOT in `gtmRelationshipTargets` but is in-ICP + has 1K+ followers → propose adding them: "@bob isn't in your relationship list yet. Looks like a fit (LocalLLaMA poster, 4K followers). Add?"

## Action-log write

Call `log_action`:

```ts
log_action({
  kind: "inbound_triage",
  summary: "BUYER @alice on Reddit — draft proposed",
  linkedEntities: [{ entityKind: "thread", entityId: "<gtmTargetThread id>" }],
  userResponse: "pending",
})
```

After operator acts, patch `userResponse` to `acted` / `ignored` / `dismissed`.

## Quality gate

`maya-output-critic` runs over EVERY drafted reply before surfacing. Voice gate is the tightest one — a reply is the operator speaking publicly. Slop or off-voice = revise.

## Failure modes

- **Author unclear (no profile, no history).** Default to NOISE. Don't surface. Don't draft.
- **Buyer intent mismatched.** If Maya classifies BUYER but the operator overrides ("they're not a buyer, just nosy"), record the override in `gtmNicheLearnings` (kind `community_quality` or `voice_angle` — depending on signal).
- **Operator hasn't responded to 5+ triage proposals.** Pause inbound triage. Send: "I've been surfacing triages you haven't acted on. Want me to switch from 'propose drafts' to 'just summarize'? Or pause triage?"

## Cost discipline

Per inbound: 1 main_maya call for classify + draft + critic (low thinking). 0-1 `scrape_creators` calls if author lookup needed. Runs many times per day but each is sub-minute.

## Anti-slop check

The drafted reply must pass slop-critic. The surface-to-operator message itself ("@alice asked …") is plain manager dispatch — no "Heads up, hot one!" or "Buyer alert!"
