---
name: write-post
description: Draft one post in the founder's voice for a specific channel. Generates 3-5 varied candidates and picks the most human — never writes one and polishes it. Every draft is written to a named reader, capped hard for length, and grounded in product truth. Outputs the draft plus the candidates it beat.
---

# write-post

Read `CONVENTIONS.md` first. It carries the four channels, the safety floor, the
tool envelope, and the voice split.

## Purpose

Turn an idea into one draft that a real person would actually post.

**Substance from the founder, form from the channel.** The idea already carries
the evidence — a complaint someone posted, a thread, a trend that passed the
bridge test. This skill decides how that gets said on this specific channel, in
this specific founder's register.

## The one rule that matters most

> **Generate 3–5 varied candidates and pick one. Never write one and polish it.**

Polishing makes a draft *more* AI, not less, because smoother reads as more
synthetic. **Variance is where humanity hides**, and a rewrite loop is a machine
for destroying variance.

So the candidates must differ in *kind*, not in wording. Different openings,
different lengths, one that's a fragment, one that doesn't explain itself. Five
polite variations of the same sentence is one candidate, not five.

Return the winner **and the ones it beat**. The losers are how the critic and the
voice profile learn what this founder's register actually is.

## Before writing

1. **Read the idea's evidence.** If an idea has no evidence, it is a guess, and
   guesses don't get published. Say so and stop.
2. **Read the voice profile** — and specifically the founder's last N edits. The
   pair *{what I wrote, what they changed it to}* is the highest-signal training
   data in this system. Carry it as few-shot on every call.
3. **Read the format card** if the idea borrowed one, and
   `PLATFORM_ALGO/{channel}.md` for the channel's register.
4. **Pull real sentences from the niche corpus.** Ten real excerpts from actual
   humans in this niche beat any amount of *"be casual and authentic."*

## Write to a reader, not a topic

*"Reply to the person who said their exports keep failing"* produces human text.
*"Write a post about our export feature"* produces slop.

**Every draft names a specific person or moment before a word is written.** If
you can't name one, the idea isn't ready — go back to the bank.

## Cap length hard, before you start

Slop expands to fill the space available. A tight cap forces the human move:
pick one point and drop the rest.

| Channel | The cap | Notes |
|---|---|---|
| **X** | 280 **weighted** | A URL counts as exactly 23 no matter its real length; CJK and emoji weigh 2. `preflight` computes this — don't count characters yourself. |
| TikTok / Instagram / YouTube | per `PLATFORM_ALGO/{channel}.md` | The caption's first line is a **hook**, never a description. |

Hashtags: **X takes 1–2 at most.** Hashtags are selected from mined sets, never
invented.

## What makes it read as AI

The critic hunts these, but don't write them in the first place:

| Class | The tells |
|---|---|
| **Lexical** | delve · tapestry · landscape · game-changer · unlock · leverage · seamless · robust · elevate · "it's worth noting" · "in today's fast-paced" |
| **Structural** | triadic lists ("fast, simple, and powerful") · the *"It's not X — it's Y"* reversal · rhetorical-question openers · "Here's the thing:" · a summary sentence closing every paragraph · suspiciously even paragraph lengths |
| **Tonal** | relentless positivity · hedging everything · manufactured enthusiasm · engagement bait ("What do you think? 👇") · explaining the obvious |
| **Register** | **too complete.** Humans write fragments, trail off, don't transition smoothly, use lowercase, leave typos. |

**The deepest one, and the hardest to catch with a word list:** AI writes to be
*complete*; a human writes to be *understood by one specific person*. AI covers
the topic. A human makes one point and stops.

## After writing

Hand the draft to `critique`. It runs on a different model, it has real veto
power, and its verdict is not a suggestion.

**Never publish straight from here.** `publish` decides publish-or-hold on its
own and will tell you which — a hold is a real answer, not a failure, and it is
never something to retry around.
