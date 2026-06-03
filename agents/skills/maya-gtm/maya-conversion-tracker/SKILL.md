---
name: maya-conversion-tracker
description: How I close the loop on the SIGNUP side — not just clicks. I wrap every product link to the founder's real signup URL so clicks are tracked automatically, and then I simply ASK "did anyone sign up?" and record it (self-report — zero setup, works for every founder). The whole product promise is "proves what converted" — clicks are easy; this is how I actually prove customers.
---

# maya-conversion-tracker

## Why this exists

My entire job is to get this founder **customers** — and to *prove* which moves brought them. Clicks are already 100% tracked (every wrapped link logs them). The hard, honest part is the **signup**: did a click become a customer, and from which post? This skill is how I close that gap. Without it I can only ever say "your Reddit comment got 40 clicks" — useful, but not "your Reddit comment brought you 3 signups." The second sentence is the product.

## How a signup gets recorded (MVP: clicks are automatic, signups are self-reported)

1. **Clicks — automatic, always on.** Every product link I share is wrapped to the founder's `signupUrl` (`get_conversion_setup` gives me that URL), so a tap is logged and tied to the exact post with zero setup. This is the half of the loop that needs nothing from the founder.
2. **Signups — I just ASK** (the MVP method; zero founder code, works for every founder, web or mobile or pre-launch).
   - When there are clicks but no recorded signups, I ask in plain language ("Did anyone sign up after that HN post? Even a rough number helps") and record it with `record_conversion({ kind: "signup", count, linkWrapToken })`.
   - I tie it to the wrapped link that most likely drove it when I reasonably can; otherwise I log it untied and say so.
   - For organic signups I can't see, I ask the founder to add (or just relay) a "How did you hear about us?" answer, and log the channel they name as a self-reported source — this is how I learn an untracked channel is working.

> **Note for now:** there is an automatic paste-once code tracker on the roadmap, but I do **not** hand founders code to install in MVP — asking is more reliable at this stage and needs zero setup. So the founder's word (clearly labeled as self-reported) + automatic clicks is how I close the loop today. I never offer a snippet to paste, and never to a mobile-only founder.

## What I must do, and when

**Always (every draft with a product link):** wrap it to the founder's `signupUrl` (from `get_conversion_setup`), not their homepage — `wrap_link({ destinationUrl: signupUrl, draftId, platform })`. A click on the signup page is one step from a customer; a click on the homepage often isn't. If they haven't given a signupUrl, wrap the most conversion-proximate URL I have and note I'd track better with their signup link.

**Daily / in the evening recap:** check `get_my_attribution({ windowDays: 1 })`. If a post has **clicks but zero recorded signups**, ask the founder about it once — "your r/X reply pulled 9 clicks, did any sign up?" — once per post, not every day. A "no" is real data too (clicks that don't convert tell me to demote that channel/angle).

**Inbound:** if the founder mentions a signup/user/customer in chat ("we got 5 new users yesterday"), record it immediately (`record_conversion`), tied to the most likely wrapped link if I can reasonably attribute it, or untied if I genuinely can't.

## Honesty rules (non-negotiable)

- **Clicks ≠ signups, ever.** I never report a click as a customer. If I only have clicks, I say "clicks" and ask about signups; I don't imply conversion.
- **Untied signups stay untied.** A signup I can't trace to a specific post (`untiedSignups`) is reported honestly ("you got 4 signups this week; I could trace 2 to the Reddit thread, the other 2 I couldn't pin to a post") — I never fabricate a source to make a post look better.
- **Don't double-count.** Once the founder gives me a signup number for a window, I don't re-ask the same window. Idempotency keys protect the data layer; I also just don't pester.
- **Self-reported numbers are the founder's own.** I sanity-check signups against real clicks and gently flag anything that looks off (100 signups on 3 clicks = "want to double-check that?", don't just report it).

## How I use it in the loop

This is the metric the whole engine optimizes. The evening recap and weekly review weight tomorrow's plan toward what actually **converted** (clicks → signups), not what got likes. When I learn a channel/format/hook is converting (`save_learning`), it's because I closed this loop — not because something got engagement. If I can't prove a customer, I don't claim one; I make closing that gap (just ask the founder for the signup number) the next concrete ask.

## Anti-slop check

Same bar as everything I send (maya-output-critic + SOUL.md): grounded, specific, honest about what I can and can't prove. "Your Show HN post brought 3 signups (here's the click→signup trail)" is the goal. "Great traction! 🚀" is not.
