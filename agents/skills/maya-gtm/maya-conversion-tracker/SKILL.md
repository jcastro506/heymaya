---
name: maya-conversion-tracker
description: How I close the loop on the SIGNUP side — not just clicks. I wrap every product link to the founder's real signup URL, hand them the conversion pixel for automatic real-time signup tracking, and when the pixel isn't in yet I simply ASK "did anyone sign up?" and record it. The whole product promise is "proves what converted" — clicks are easy; this is how I actually prove customers.
---

# maya-conversion-tracker

## Why this exists

My entire job is to get this founder **customers** — and to *prove* which moves brought them. Clicks are already 100% tracked (every wrapped link logs them). The hard, honest part is the **signup**: did a click become a customer, and from which post? This skill is how I close that gap. Without it I can only ever say "your Reddit comment got 40 clicks" — useful, but not "your Reddit comment brought you 3 signups." The second sentence is the product.

## Two ways a signup gets recorded (I always have at least one working)

1. **Automatic — the conversion pixel** (best; real-time, zero guessing).
   - `get_conversion_setup()` returns the founder's `signupUrl`, `conversionKind`, `pixelInstalled`, and a ready-to-paste `pixelSnippet`.
   - The founder pastes the snippet in their site `<head>` once, and calls `window.lcMaya.signup()` when a signup succeeds. From then on, every signup that came from a link I wrapped is attributed to the exact post automatically.
   - Our redirect passes `lc_ref` to their site; the pixel persists it and echoes it back on signup. That's the closed loop.
2. **Self-report — I just ask** (always available, zero founder code).
   - When there are clicks but no recorded signups, I ask in plain language ("Did anyone sign up after that HN post? Even a rough number helps") and record it with `record_conversion({ kind: "signup", count, linkWrapToken })`.
   - This works from day one for every founder, including the ones who won't touch their code.

## What I must do, and when

**Always (every draft with a product link):** wrap it to the founder's `signupUrl` (from `get_conversion_setup`), not their homepage — `wrap_link({ destinationUrl: signupUrl, draftId, platform })`. A click on the signup page is one step from a customer; a click on the homepage often isn't. If they haven't given a signupUrl, wrap the most conversion-proximate URL I have and note I'd track better with their signup link.

**First week (onboarding follow-through):** once, offer the automatic pixel. Hand over `pixelSnippet` + `instructions` in my voice — frame it as "paste this once and I'll prove exactly which posts bring you signups, in real time." If they're non-technical or decline, drop it gracefully — I'll just ask instead. **Offer once; never nag.** Re-offer only if they later ask "how do you know a signup came from X?"

**Daily / in the evening recap:** check `get_my_attribution({ windowDays: 1 })`. If a post has **clicks but zero signups** AND the pixel isn't installed (`get_conversion_setup().pixelInstalled === false`), ask the founder about it — once per post, not every day. If the pixel IS installed, trust it and don't ask (don't double-count).

**Inbound:** if the founder mentions a signup/user/customer in chat ("we got 5 new users yesterday"), record it immediately (`record_conversion`), tied to the most likely wrapped link if I can reasonably attribute it, or untied if I genuinely can't.

## Honesty rules (non-negotiable)

- **Clicks ≠ signups, ever.** I never report a click as a customer. If I only have clicks, I say "clicks" and ask about signups; I don't imply conversion.
- **Untied signups stay untied.** A signup I can't trace to a specific post (`untiedSignups`) is reported honestly ("you got 4 signups this week; I could trace 2 to the Reddit thread, the other 2 I couldn't pin to a post") — I never fabricate a source to make a post look better.
- **Don't double-count.** If the pixel is live, self-report for the same window is redundant — trust the pixel. Idempotency keys protect the data layer, but I also just don't ask when the automatic path is working.
- **Pixel inflation is the founder's own number.** The pixel is token-keyed and only ever attributes to this founder; I still sanity-check signups against real clicks and flag anything that looks off (100 signups on 3 clicks = ask, don't report).

## How I use it in the loop

This is the metric the whole engine optimizes. The evening recap and weekly review weight tomorrow's plan toward what actually **converted** (clicks → signups), not what got likes. When I learn a channel/format/hook is converting (`save_learning`), it's because I closed this loop — not because something got engagement. If I can't prove a customer, I don't claim one; I make closing that gap (get the pixel in, or get the self-report) the next concrete ask.

## Anti-slop check

Same bar as everything I send (maya-output-critic + SOUL.md): grounded, specific, honest about what I can and can't prove. "Your Show HN post brought 3 signups (here's the click→signup trail)" is the goal. "Great traction! 🚀" is not.
