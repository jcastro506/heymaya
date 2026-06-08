---
name: maya-safety-critic
description: The mandatory outbound ban-safety FORCE gate that maya-publisher runs before any post ships. Blocks unsafe publishes, FORCES Reddit/TikTok to one-tap-confirm, and is one of the three verdicts (voice-match + slop + safety) every post must clear. Backed server-side by convex/gtmMaya/outboundFirewall.ts + approvalPublishing.ts.
---

# maya-safety-critic

## Purpose

This is the **mandatory pre-publish ban-safety gate** that lives INSIDE `maya-publisher`. Nothing ships to a live channel until it clears this gate. Where `maya-slop-critic` protects the founder's voice and `maya-voice-matcher` protects their register, `maya-safety-critic` protects their **account** — the one thing Maya never gambles. A misfired post can get a founder shadowbanned, rule-flagged, or permanently restricted on a channel, and that is a worse outcome than a missed post. So this gate is fail-closed: when in doubt, it blocks or downgrades to a human confirm, never fires.

It is not a separate runtime step the founder sees. It is the safety verdict `maya-publisher` runs as part of its gate stack, backed server-side by `convex/gtmMaya/outboundFirewall.ts` (the outbound firewall) and `convex/gtmMaya/approvalPublishing.ts` (the voice/slop publish guard). Maya runs it on her side; the server enforces it independently so a prompt bug can never bypass it.

## When to invoke

- ALWAYS, inside `maya-publisher`, before any `post_to_channel`, reply, or DM ships — auto-post or confirmed.
- It runs AFTER the draft has a voice-match score and a slop verdict, because the final ship decision is the union of all three (see below).
- NEVER skipped. A publish path that reaches `post_to_channel` without this gate having passed is a defect.

## The FORCE gate — what it does, fail-closed

1. **FORCE Reddit/TikTok to one-tap-confirm — regardless of what was queued.** No matter what `status` a Reddit or TikTok event arrived with (even if a populator bug queued it as auto), this gate forces it to `needs_confirm`: Maya emits a one-tap Telegram confirm card with a real preview and posts ONLY on the founder's tap. Reddit because Zernio's own >50% failure rate (subreddit-rule violations) makes autonomous posting reckless; TikTok because its `content_preview_confirmed` + `express_consent_given` flags are legal human-consent requirements that may only be set true behind a genuine preview. The server forces these rows to `needs_confirm` too — this gate never relies on the server alone.

2. **Block publishing to an unconnected or unhealthy channel.** This gate checks connection state via `get_connection_health` / `list_connected_accounts` (and USER.md's "Connected accounts" section). If the channel isn't connected or `canPost` is false (token expired/revoked), it BLOCKS the auto-publish and routes to the deep-link paste fallback (the founder pastes it by hand) + the reconnect nudge (maya-connection-health). Firing into a channel that isn't connected is a silent failure — the worst outcome — so this is hard-blocked. The server (`outboundFirewall.ts`) independently enforces this, so a prompt bug can't bypass it.

3. **Block a post that violates launch preconditions.** A product pitch or launch on a cold/un-warmed account is a guaranteed void and a ban risk. If the channel's warmth/launch preconditions (the launch-precondition gate in `maya-calendar-populator`) are not met — e.g. pitching the product on a brand-new account that hasn't earned authority — this gate BLOCKS it and hands back the warm-up work instead. It also holds the cross-channel post ceiling: original posts are rationed (~1/day/channel, ≤1 pitch/week), so a second same-day original post on one channel is blocked as over-posting.

4. **Block on slop / off-voice (the union).** A post that trips the PLAYBOOK § 6 ban list, or whose voice-match score is below the `0.7` floor, does not ship — it goes back for a rewrite.

## The three-verdict gate (a post ships only if ALL THREE pass)

Every post that goes live must clear three independent verdicts. The publish is the AND of all three — any one failing holds the post:

1. **Voice-match** — `voiceMatchScore >= 0.7` (from `maya-voice-matcher`). Below the floor → rewrite.
2. **Slop** — `slopCriticPassed === true` (from `maya-slop-critic`, PLAYBOOK § 6). Trips the ban list → rewrite.
3. **Safety** — this gate: connection healthy, launch preconditions met, post ceiling respected, channel not forced-to-confirm-and-unconfirmed.

If all three pass on an auto-post channel (X / LinkedIn / Instagram / YouTube) and the connection is healthy and caps allow it, Maya auto-publishes via `post_to_channel`. If any fails, she does not.

## Low voice-confidence routes to confirm, not auto

When the voice-match confidence is low — a borderline `voiceMatchScore`, or a founder whose `voiceProfile` confidence is `none` (zero handles at onboarding, so the matcher passes-with-warning rather than hard-blocking) — this gate does NOT auto-publish even on an auto-post channel. It downgrades to a one-tap-confirm card so a human eyes the post before it goes out in their name. The fail-closed default for an uncertain voice is "let the founder confirm," never "fire it anyway."

## Output

A verdict `maya-publisher` consumes: `pass` (ship per its normal path), `force_confirm` (downgrade to a one-tap Telegram card — Reddit/TikTok always, plus low-voice-confidence and borderline cases), or `block` (do not ship — fall back to the paste draft and/or hand the warm-up work back, with the reason recorded verbatim). On a block or force, the reason is plain-language and never leaks internals to the founder.

## Cost discipline

No external API spend. One connection-health read, one launch-precondition check (both cached Convex reads), and the union of the already-computed voice + slop verdicts. Sub-second. Runs once per publish attempt, no loops.

## Anti-slop check

This gate's own founder-facing notes ("held your Reddit post for a tap" / "X isn't connected, here's the paste-ready draft") are plain manager dispatch — no "Safety alert! 🚨", no internals, no skill slugs.
