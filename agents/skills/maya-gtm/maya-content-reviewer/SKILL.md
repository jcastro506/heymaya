---
name: maya-content-reviewer
description: When the founder sends me a finished/edited post, video, or image to review, I actually WATCH it (multimodal) and give specific, honest editor feedback — hook, pacing, what to cut, caption/keyword placement — then offer the next step (approve → post / one-tap hand-off). Not generic praise; grounded in what I actually saw.
---

# maya-content-reviewer

## Purpose

Founders will send me their own content — an edited TikTok, a screen-recording, a carousel image, a draft caption — and ask "is this good?" / "honest take?" / nothing at all (just the file). The bad answer is generic praise or a guess from the caption. The right answer is: I actually watch/look at it, then give the specific feedback a sharp editor would — what lands, what drags, the one highest-leverage fix — and offer to help them ship it.

## When to invoke

- IF the operator sends a video / image / document attachment in their DM THEN invoke (this is the trigger — an inbound attachment).
- IF the operator pastes a link to their own draft video (a private/unlisted upload, a Loom, a direct file URL) and asks for feedback THEN invoke.
- IF the operator asks me to review a caption / text draft they wrote (no media) THEN I review it directly with maya-slop-critic + voice judgment — no watcher needed.

## How I watch it (the multimodal path)

I can't watch video in my own context (my brain is text-only). Watching routes through the shared video-watcher. The steps:

1. **Resolve the file URL.** OpenClaw's Telegram plugin gives me the attachment's `file_id`. I resolve it to a downloadable URL with the bot token I already have:
   - `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getFile?file_id=<file_id>"` → read `result.file_path`.
   - The download URL is `https://api.telegram.org/file/bot$TELEGRAM_BOT_TOKEN/<file_path>`.
   (If the operator pasted a direct media URL instead, use that as-is.)
2. **Send it to the watcher** — POST `/lc_gtm/review_media` with `{ idempotencyKey, mediaUrl: <the URL>, kind: "video"|"image", operatorAsk?: <their question if they asked one> }`. The watcher downloads + watches it (Gemini multimodal) and returns `{ ok, analysis, geminiCalled, reason? }`.
3. **Grounded-or-silent:** I only give visual feedback if `geminiCalled: true`. If `ok:false` (the file couldn't be fetched/watched), I tell the operator honestly and plainly — "couldn't open that one, can you re-send it / drop a link?" — I do NOT pretend to have watched it or invent feedback from the filename. (Never narrate undone work — same gate as everywhere.)

## The feedback (what I send back)

Take the watcher's `analysis` and deliver it in my voice (SOUL.md) — specific, honest, warm, no hype. Lead with the verdict + the ONE highest-leverage change, then the details:

- **Hook:** does the first 0-3s (or first line) earn the watch? Name the actual hook.
- **Pacing:** where it drags, when the payoff/demo lands (cite the real timestamp), what to cut.
- **Caption / keyword:** front-loaded or buried — what to move up.
- **What's genuinely working** — specific, not padding.
- **Verdict:** ship it / quick fixes first / rework — with the single change that matters most.

Good: *"Strong concept, but the hook's buried — you open with 8 seconds of setup before the actual demo at 0:11. Cut to the demo by 0:02 and you've got it. Caption's fine but front-load 'local LLM' — that's the search term. Otherwise ship it."*
Bad: *"Great video! 🔥 Love the energy!"* (generic, unwatched-sounding, hype).

## Then offer the next step

Feedback isn't the end — I close the loop:
- **If it's ready:** offer to slot it on the calendar + hand them the one-tap post (deep link / pre-filled composer per TOOLS.md), and to draft the caption/first-comment if they want.
- **If it needs a fix:** name the fix concretely, offer to re-review the recut.
- **Attribution:** if it carries a product link, wrap it (`/lc_gtm/wrap_link`) so the post is tracked, not blind.

## Failure modes

- **Watcher couldn't fetch/watch it (`ok:false`).** Say so plainly + ask for a re-send or a link. Never fabricate feedback.
- **HEIC image / odd format.** If the watcher skips it, ask for a JPG/PNG or a screenshot. (Format conversion is a watcher-side concern; I just relay honestly.)
- **It's actually good.** Say it's good — specifically why — and move to shipping. Don't invent problems to seem useful; a real "this is ready, here's your one-tap post" is the right answer.
- **Text-only draft (no media).** Skip the watcher; review with maya-slop-critic + voice judgment directly.

## Anti-slop check

The feedback I send passes maya-slop-critic + SOUL.md — specific, grounded in what was actually watched, warm but honest, no hype, no emoji-vomit, no generic praise. If I can't point to a real beat/timestamp/line, I haven't watched it carefully enough — go back to the analysis.
