# Creatify / Creative layer — scope & test plan (V1)

**Status:** KEEP for now — there's room for it. Test what it can do; kill it later if it proves useless.
**Companion:** `docs/AGENT_REDESIGN_V2.md` (§6 `make-creative`, §7.6, §9 tiers).

## Decision (2026-06-25)
Keep Creatify as the creative-render layer and **test its range** before committing it to a tier. It is currently **unconfigured on prod** (`CREATIFY_API_ID` / `CREATIFY_API_KEY` absent) — all calls no-op until the operator adds keys.

## The positioning that keeps us on the right side of the anti-slop line
Reposition from "**Maya makes your videos**" → "**Maya makes the visuals.**" Rationale (from the Eisenberg/anti-slop discussion):
- **Images / graphics / memes / product mockups / motion graphics / thumbnails / ad-style creative = STRONG.** Nobody expects a product graphic or a meme to be a "real person," so it carries **zero slop-penalty** — it's pure production leverage. Clear yes.
- **AI-avatar UGC "talking head" video that poses as a real human = SKEPTICAL for organic.** This is exactly the slop the timeline + algorithms are down-ranking. Risky for organic trust-building. Position it **opt-in / experimental / paid-ad use**, never the headline.
- **Authentic founder video** (what actually wins organically) = the founder's *real* face/footage — not Creatify's job (that's a clip/caption tool, e.g. Opus/Captions). Out of v1 scope.
- **Net:** creative is a **tier add-on / fast-follow**, not the core wedge. The wedge is research + native-text engagement + attribution. Creative enhances the *posting* motion only.

## What to TEST (the operator wants to see the range)
Give Maya a `make-creative` skill that exercises Creatify's API surface and log what's actually good:
1. **TikTok/Reel URL → "recreate this for our product"** — does the URL-to-video / style-transfer produce anything usable + grounded in our product?
2. **"Make me images / a graphic / a meme"** for a post — product-grounded image gen.
3. **URL-to-video** (paste product URL → ad-style short) — Creatify's flagship; grounded?
4. **Avatar / UGC video** — generate one, judge realism + slop-risk honestly.
5. **Variation-first** — N hook variants of one creative (the proven paid-ad pattern); let attribution pick winners.

For each: capture cost (credits/render), quality, re-render burn, and a slop-risk verdict.

## Guardrails (from competitor scan)
- **Cap per-post render spend; cache good renders; never blind auto-retry** (credit-burn is the universal trap — Creatify/HeyGen/Revid all bleed credits on re-renders).
- **Keep the render layer interface-isolated** — Captions API (1 credit/sec, clean submit/poll) is a viable fallback; avatar rug-pulls + billing complaints are endemic across all vendors. Don't hard-couple.
- **Ground every render in real product context** (scraped screenshots/copy/USPs) — never generic.
- **Critic gate before any creative ships** (slop / off-brand / looks-AI veto).

## Kill criteria
If, after testing, the creative output is (a) consistently slop-coded, (b) too expensive per usable asset, or (c) not driving engagement/signups in attribution — **drop it** and keep Maya text-and-images only. The product survives without it; it's an enhancer, not the engine.
