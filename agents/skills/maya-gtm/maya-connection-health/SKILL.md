---
name: maya-connection-health
description: The anti-silent-failure guardian defending the "we post for you" headline. Reacts to account.disconnected webhooks and health warnings, detects token expiry/revoke, explains it in plain founder language, and hands over a reconnect deep link. Drives the Settings "Connected accounts" chips and fires the proactive reconnect nudge before posting silently breaks (push-don't-pull).
---

# maya-connection-health

## Purpose

The headline is "Maya posts for you." The way that promise breaks quietly is a connection going stale: a token expires or the founder revokes access, and from then on Maya's posts fire into a dead channel and nothing lands. This skill is the guardian against that silent failure. It watches connection health, catches a disconnect the moment it happens, explains it to the founder in plain language, and hands them a one-tap reconnect link before they ever notice posting broke. Push, don't pull. Maya tells the founder, the founder doesn't discover it.

## When to invoke

- Event-driven: an `account.disconnected` webhook fires for a connected channel.
- IF a health check returns a warning or `canPost: false` for a channel THEN react.
- IF maya-publisher tried to post and hit an unhealthy connection THEN take the handoff and run the reconnect flow.
- On-demand: the founder asks "are my accounts connected?" and Maya reports the current health of each.
- HEARTBEAT-COMPATIBLE for the periodic health sweep, but the reconnect nudge is the action.

## Required reads

1. **USER.md** — operator voice and connected-accounts state.
2. **GTM.md** — the bet channels (so Maya prioritizes reconnecting the channels she actually posts to).
3. **TOOLS.md** — `get_connection_health`, `list_connected_accounts`, and the connect-link tool that re-issues a Zernio connect deep link. Go through the typed tools, never a raw Zernio endpoint.

## What Maya does on a disconnect or warning

1. **Detect the state.** Read which channel disconnected and why (token expired vs revoked vs a softer health warning). Confirm against `get_connection_health` so Maya isn't reacting to a transient blip.
2. **Explain it plainly.** Tell the founder what happened in human terms, and normalize it so it doesn't feel like something they broke. For example: "your TikTok token expired, that's normal, it happens about every 60 days. Tap here to reconnect and I'll keep posting." Token expiry is routine, not a fault, and Maya frames it that way.
3. **Hand over the reconnect link.** Re-issue the Zernio connect deep link for that channel and put it in the Telegram nudge as a one-tap. The founder taps through the same hosted-OAuth window they used at connect.
4. **Hold posting on that channel until healthy.** While a channel is disconnected, maya-publisher falls back to the deep-link paste draft for that channel (it does not fire into a dead connection). Once the reconnect lands and health reads `canPost: true`, auto-post resumes.

## Trust + ban-safety reassurance (the connect-and-reconnect framing)

Every connect or reconnect prompt carries the trust framing, because it's what makes the founder comfortable tapping: "Maya never sees your password. Zernio handles the login, and you can revoke access anytime." The OAuth is hosted by Zernio, Maya never touches the credential, and the founder stays in control. Maya uses the same framing at first-connect (the upsell to connect a channel) and at reconnect, so it's consistent and the founder learns to trust the tap. This reassurance is also why a reconnect is low-friction: revoking and re-granting is the founder's right, not a problem.

## Driving the Settings panel + the proactive nudge

- **Settings "Connected accounts" chips.** Maya keeps each channel's chip accurate: `healthy` (connected, `canPost` true), `warning` (connected but degrading, e.g. nearing expiry or a soft health flag), and `needs-reconnect` (disconnected, revoked, or `canPost` false). The chip is the at-a-glance truth of what's live.
- **Proactive Telegram reconnect nudge.** The moment a channel needs a reconnect, Maya fires ONE Telegram nudge with the plain explanation and the one-tap reconnect link. She does not wait for the founder to notice their posts stopped landing. If a warning channel is trending toward expiry, she can nudge ahead of the break rather than after. This is the push-don't-pull discipline applied to connection health: silent breakage is the failure mode, and a proactive nudge is the fix.

## Failure modes

- **Transient blip vs real disconnect.** Confirm against `get_connection_health` before nudging, so Maya doesn't cry wolf on a momentary hiccup. A real disconnect persists, a blip clears.
- **Founder ignores the reconnect nudge.** Re-surface it on a sensible cadence (not spam), and keep the channel in deep-link fallback so the founder can still post by hand in the meantime. Make the cost clear plainly: "your LinkedIn is still disconnected, so I've been handing you paste-it drafts instead of posting for you. One tap fixes it."
- **Reconnect lands but health still reads can't-post.** Don't claim it's fixed. Surface that the reconnect went through but the channel still can't post (e.g. an IG account that's still personal, not Business), and route the founder to the actual fix.
- **Revoked vs expired.** Both lead to the same one-tap reconnect, but Maya's wording differs: expiry is routine ("happens every ~60 days"), revoke means the founder chose to disconnect, so Maya checks intent ("looks like you disconnected X on purpose, want it back or should I drop it from your plan?").

## Cost discipline

The health sweep is a light periodic check, and the webhook drives the real-time reactions, so this is cheap. Per event: one `get_connection_health` confirm, one connect-link re-issue, one Telegram nudge. No polling loops.

## Anti-slop check

The reconnect nudge is plain, calm founder language. Maya normalizes the expiry instead of alarming ("that's normal, happens every couple months"), never "URGENT: your account is DOWN! 🚨". The trust framing is steady and reassuring, not salesy.
