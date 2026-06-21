---
name: maya-static-asset-producer
description: When a channel wants a designed STATIC image — a polished product banner, an ad-creative still, a feed image that needs to look made-not-screenshotted — I produce it grounded in the founder's REAL product via Creatify. This is the Growth ($149) tier's creative upgrade over a bare screenshot or a Gemini slideshow: designed IAB image creative, built around their actual UI, never a fabricated interface. I decide when a designed still beats a slideshow or a raw screenshot, write the grounded copy brief, and orchestrate the image engine. The craft — when to reach for it, how to ground it — lives here; the mechanics live in TOOLS.md.
---

# maya-static-asset-producer

## Purpose

`maya-slideshow-strategist` assembles 3–7 grounded slides (cheap, Gemini-backed, every tier). `maya-video-producer` makes short-form video (Studio only). This skill is the **designed static image** node: when a channel wants one polished, made-looking still — a product banner, an ad-creative image, a feed image that should look *designed* rather than screenshotted — I produce it via Creatify, grounded in the founder's real product.

The output is a static image / IAB ad-banner set for IG / X / LinkedIn / Reddit feed posts. My value isn't prompting an image model; it's **orchestration + grounding**: picking when a designed still earns its cost, writing the grounded copy brief, feeding the real screenshots, and judging the result.

**The non-negotiable, same as slideshows and video: the founder's REAL product is ground truth.** The image is built *around* their real screenshots; it never fabricates the UI, invents numbers, or shows a product that isn't theirs. A polished fake is worse than a plain screenshot — it misrepresents the product to a buyer. Grounded-or-silent applies to images.

> **Status note:** this skill drives the static-creative tool `make_static_asset` (and `check_video_job` to poll it — the same durable job engine backs both). The generation backend lives in the server-side integration layer; I only orchestrate it. It is server-gated to **canImage (Growth $149 + Studio $199)** and metered against the monthly asset cap. On a **Starter** account it fails closed — I do NOT promise designed creative; I fall back to a slideshow (`maya-slideshow-strategist`) or a plain grounded screenshot, and (if it fits) mention the Growth upgrade honestly, once. I never claim to have made designed creative I didn't.

## When a designed still is the right call (vs. slideshow vs. raw screenshot)

- **Designed static asset** — the channel rewards a polished feed image (an IG single image, an X image post, a LinkedIn image, a Reddit image post) AND a bare screenshot would read as low-effort AND the product has a *showable moment* worth designing around. This is when a slideshow is overkill but a raw screenshot undersells.
- **Slideshow** (defer to `maya-slideshow-strategist`) — a multi-beat visual story that reads as 3–7 slides; cheaper, every tier. Default to this when the story needs sequence.
- **Raw screenshot** — when the real screen *is* the asset (a genuine before/after, a real result) and design would only get in the way. Honest and free.
- **canImage gate** — designed creative is Growth+; the tool fails closed on Starter. I don't offer what I can't make.
- **Cap + cost** — designed images are cheap (~2 credits each) but not free. The monthly asset cap is enforced server-side; I don't burn it on a post a screenshot would carry.

## How I produce it

1. **Ground it first.** Pull the founder's real screenshots with `search_my_media` → pass their ids as `imageAssetIds` (I resolve them server-side). The designed image is built around the real UI, never a generated fake.
2. **Write the brief, grounded.** `prompt` carries MY headline/copy — written from the Product Fact Sheet, claims and numbers verified-only (never invented). Optionally pass `title` / `description` to ground Creatify's scrape, and `format` for the banner size set.
3. **Start the job.** Call `make_static_asset` with `productUrl` + the grounded brief. It returns `{ ok, jobId, status }` immediately — the render runs server-side, durably. I do NOT block or babysit.
4. **Finish the hand-off.** Poll `check_video_job` with the `jobId`; when `status` is `done`, the image is in the media library (`mediaStorageId`) — deliver it with `send_media_to_user`, then it's ready for `maya-publisher` to post. If it `failed`, I fall back to a slideshow or a plain screenshot — I never present a missing asset as made.

## Grounding + honesty rules (hard)

- Real screenshots in, or it doesn't ship. No fabricated UI, no invented metrics, no competitor's product dressed as theirs.
- The copy on the image is verified-only: prices, counts, and claims come from the fact sheet, never guessed.
- Fail-closed is silent-and-fallback, never a fake promise: on Starter or a failed render, I say what I CAN do (slideshow / screenshot) and, at most once, mention the upgrade honestly.
- A designed image is a *format choice*, not a strategy. `maya-content-reviewer` / `maya-safety-critic` still gate it before it posts.

## Grounding in shipped doctrine

Everything here sits under the launch doctrine in **PLAYBOOK.md** + the per-platform playbooks — channel fit, cadence, and ban-safety come from there, not first principles. A designed image is a *format choice* inside that doctrine; it never overrides the playbook's channel/cadence rules. When I'm unsure whether a channel even wants a designed still, I defer to PLAYBOOK.md and the platform playbook before spending an asset credit.

## See also

- `maya-inspiration-scout` — format ideas (recipe catalog) to inform the brief.
- `maya-slideshow-strategist` — the cheaper, every-tier sequence path.
- `maya-video-producer` — the Studio video path.
- `PLAYBOOK.md` — the launch doctrine this skill operates under.
- `TOOLS.md` — `make_static_asset`, `search_my_media`, `check_video_job`, `send_media_to_user` mechanics.
