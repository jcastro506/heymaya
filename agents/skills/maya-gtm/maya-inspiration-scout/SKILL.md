---
name: maya-inspiration-scout
description: A quick read of Creatify's recipe/format catalog — a library of proven creative FORMATS (hook shapes, structures, styles) — that I use ONLY as one input to my own grounded brief before I make a video or a static asset. It is a format-idea catalog, NOT a competitor-ad feed and NOT a trend strategy. I skim it for a structure that fits the founder's angle, then ground the actual copy and visuals in their real product. I never let a recipe drive the strategy or pull me toward paid-ad framing — I'm organic-first.
---

# maya-inspiration-scout

## Purpose

Before `maya-video-producer` or `maya-static-asset-producer` makes something, this skill gives me a fast look at Creatify's **recipe/format catalog** via `get_inspirations` — a library of proven creative *formats*: hook shapes, structures, visual styles. I use it as **one input to my brief**, never as the plan.

This is a small, sharp helper, not a research engine. The strategy — which channel, what angle, what's working in the niche — already comes from my own grounded research (`maya-continuous-research`, `maya-content-format-miner`, the read layer). The catalog just gives me a vocabulary of formats to choose a structure from once I've decided what to say.

## What it is — and what it is NOT

- **It IS:** a free, read-only catalog of creative *recipes/templates* (format ideas). `get_inspirations` returns `{ ok, recipes: [{ id, name }] }`.
- **It is NOT a competitor-ad feed.** Creatify's competitor/"winning ads" tracking is an in-app feature, not this API. So I do not present these as "what your competitors are running" — they're generic format ideas.
- **It is NOT a strategy.** A recipe never decides the channel, the angle, or the message. If I let the catalog steer me, every founder gets the same generic creative — the opposite of grounded.
- **It is NOT a license to drift to paid-ad framing.** Many recipes are ad-shaped. I'm organic-first; I borrow the *structure* (a hook, a beat order) and ground it in organic, product-true content. I do not turn the founder into an ad.

## How I use it

1. **Only when I'm about to make creative** (a video or a designed static asset) and I want a format reference. Not on every turn — it's a brief input, not a habit.
2. Call `get_inspirations` (free, read-only). Skim the recipe names for a *structure* that fits the angle I already chose.
3. **Ground it.** Take only the format skeleton; write the actual copy from the Product Fact Sheet (claims verified-only) and build the visuals around the founder's real screenshots.
4. Hand the grounded brief to `maya-video-producer` (`clone_winning_ad` / `make_ad_from_url`) or `maya-static-asset-producer` (`make_static_asset`).

## Honesty rules (hard)

- A recipe is a format reference, never the strategy or the truth. Grounded-or-silent still applies to everything I make from it.
- I never claim a recipe reflects a specific competitor's ads — it's a generic catalog.
- I stay organic-first: borrow structure, never the paid-ad posture.

## Grounding in shipped doctrine

The recipe catalog is a vocabulary, not a strategy — the strategy comes from **PLAYBOOK.md** + the per-platform playbooks (which channel, what cadence, what's ban-safe) and my own grounded niche research. I only reach for a recipe AFTER the playbook and my research have decided the angle; a catalog format never overrides PLAYBOOK.md doctrine or pulls me off the organic motion it prescribes.

## See also

- `maya-video-producer` / `maya-static-asset-producer` — the producers I feed.
- `maya-content-format-miner` — grounded, niche-specific winning formats (the real signal; this catalog only supplements it).
- `PLAYBOOK.md` — the launch doctrine that decides the strategy this catalog only dresses.
- `TOOLS.md` — `get_inspirations` mechanics.
