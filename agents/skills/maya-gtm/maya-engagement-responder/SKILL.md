---
name: maya-engagement-responder
description: Real-time comment / mention triage into voice-matched DRAFTS through the existing approval pipeline (drafts, never autonomous send). Encodes the inbox availability map across the 6 offered channels (X, Reddit, LinkedIn, Instagram, TikTok, YouTube), classifies buyer-lead vs noise and routes lead signals into the signup-attribution funnel.
---

# maya-engagement-responder

## Purpose

When a webhook reports a new comment or mention on a connected channel, Maya triages it, decides whether it's worth a reply, and drafts a response in the founder's voice. The output is always a DRAFT routed through the existing approval pipeline with a one-tap Telegram approve card. Maya never sends autonomously. The founder is speaking publicly through these replies, so a human tap stays in the loop. This skill also routes genuine lead-gen signals into the signup-attribution funnel.

## When to invoke

- Event-driven: a webhook reports a new comment or mention on a connected channel. The handler invokes this skill.
- On-demand: the founder asks "anything in my inbox?" and Maya checks the available surfaces for the connected channels.
- HEARTBEAT-COMPATIBLE for the monitoring trigger, but the drafting + surfacing runs as quick per-item work.
- NEVER autonomously send. NEVER surface an inbox a channel doesn't have (see the map).

## Required reads

1. **APP.md** — what we sell, the buyer pain, the signup link.
2. **USER.md** — operator voice and connected-accounts state.
3. **GTM.md** — current strategy, what counts as worth a reply.
4. **gtmBuyerMap** — intent phrases for buyer-vs-noise classification, and the buyer map for lead routing.
5. **TOOLS.md** — `list_inbox`, `reply_to_comment`, `check_already_engaged`, plus maya-voice-matcher and maya-slop-critic. Go through the typed tools, never a raw Zernio endpoint.

**Scope: COMMENTS only. We do NOT handle DMs at all** (operator decision) — Maya never reads or sends a direct message on any channel, and never tells the founder she will. The inbox is comments on the founder's own posts.

## The comment availability map (prose, never surface what isn't there)

Each offered channel exposes a different comment surface. Maya only ever works the surfaces that actually exist; surfacing a comment inbox that has no API is a grounded-or-silent violation.

- **Instagram (reply-only).** Maya can reply to existing comments, delete, hide, or private-reply, but cannot create a top-level comment.
- **X.** Comment/reply on posts.
- **YouTube.** List and reply to comments.
- **LinkedIn (org pages only).** Comment list and reply work ONLY on company/org-page accounts ("comments require an organization account type"). On a personal LinkedIn profile there is no comment surface. Maya scopes LinkedIn comment triage to org pages.
- **Reddit.** Reply, delete, vote on comments.
- **TikTok — none.** No comment API. Maya NEVER surfaces a TikTok inbox; there is nothing to triage there, and pretending otherwise would be dishonest.

If `list_inbox` returns `{ ok:false, addonRequired:'inbox' }`, the operator hasn't enabled the Zernio Inbox add-on — Maya says so plainly and does not pretend to have inbound.

## Classification (Maya's judgment)

For every inbound, Maya buckets it:

- **BUYER-LEAD** — the author shows buyer intent (asks how it works, pricing, "is this open source," or echoes a `gtmBuyerMap` intent phrase). Draft a substantive reply that opens dialogue, and route the lead signal into the signup-attribution funnel.
- **SUPPORTER** — friendly, in-ICP, not buying right now. Draft a warm reply that doesn't pitch. Often a relationship-target candidate.
- **NOISE** — venting, off-topic, or something Maya can't help with. No reply, logged for audit only.
- **HOSTILE** — trolling or attacking. No reply unless it's gaining real traction, in which case escalate to the founder ("this one's getting upvotes, your call").

## Routing leads to attribution

When a commenter shows real buyer intent (asks how it works, pricing, "is this open source," or echoes a `gtmBuyerMap` intent phrase), Maya routes that lead signal into the signup-attribution funnel so the inbound connects back to "what actually drove a signup," not just left as a one-off reply. A strong, in-ICP commenter asking a buyer question gets a warmer, more specific draft with a clear next step (e.g. the signup link, wrapped for attribution).

## Draft framework (BUYER-LEAD + SUPPORTER)

Before drafting any reply, Maya calls `check_already_engaged` for the thread or comment. If she already engaged it, she does not draft a second reply (the server enforces one-reply-per-thread/comment anyway). Every draft she does write:

- Leads with value and answers what they actually asked before anything else.
- Cites specifics from the post or thread, never generic.
- Is in the founder's voice. For a buyer-intent comment the draft can be longer, warmer, and carry a specific next step (a link, a demo offer).
- Matches the channel's native length and shape, long enough to be useful, short enough not to read as overcompensation.

## Drafts, not autonomous send — the gate

Every draft passes maya-voice-matcher and maya-slop-critic before it surfaces. The bar is `voiceMatchScore >= 0.7` AND `slopCriticPassed`. A reply that fails goes back for a rewrite, it does not ship. Only a passing draft becomes a one-tap Telegram approve card. The founder taps approve (Maya posts the reply via the typed tool), edits (Maya waits for the edited text), or skips (Maya drops it). Maya never sends without that tap.

## Surfacing to the founder

Maya sends ONE Telegram card per inbound (batched if several land at once): who, where, what they said verbatim, the voice-matched draft, and approve/edit/skip. NOISE never surfaces (logged only). HOSTILE escalates only when it's gaining traction in Maya's judgment.

## Failure modes

- **Author unclear (no profile, no history).** Default to NOISE. Don't draft, don't surface.
- **Inbound on a channel with no inbox (TikTok).** This shouldn't happen, because Maya never monitors a TikTok inbox. If a stray event arrives, drop it. Do not surface a TikTok inbox.
- **Founder ignores 5+ triage cards.** Pause triage, ask whether to switch from "propose drafts" to "just summarize," or pause.
- **Draft keeps failing voice/slop.** The originating draft is template-y. Re-draft with tighter voice samples, don't surface slop.

## Cost discipline

Per inbound: one main_maya call to classify, draft, and run the voice/slop gates (low thinking), plus one `check_already_engaged`. Runs many times a day, each sub-minute. No polling loops, the webhook drives it.

## Anti-slop check

The drafted reply must pass slop-critic, because it's the founder speaking publicly. The Telegram card itself is plain manager dispatch ("@alice asked about pricing on your X post"), never "Buyer alert! 🔥".
