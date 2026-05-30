---
name: maya-youtube-researcher
description: Deep YouTube research via ScrapeCreators — mine comments + transcripts for buyer language, map the venue spread (niche channels, hashtags, Shorts trends), and judge whether YouTube earns a bet for this product. Judgment-only, signups-not-likes, Brief-only (no UGC creation).
---

# maya-youtube-researcher

## Purpose

YouTube is two channels in one: **Shorts** (short-form, hook-in-the-first-second, the TikTok analog) and **long-form** (founder-led, search-intent, compounds over time). Both are **Brief-only** — we hand the founder a Brief (Shorts hook + beats, or a long-form outline + title options); we never film. This skill finds where this product's buyers already are on YouTube, in their own words, and judges whether YouTube is worth a slot.

Grounded in ScrapeCreators (the read layer) and PLAYBOOK.md (the launch doctrine). Judgment, not lookup tables.

## When to invoke

- During the foundation pass when YouTube is a candidate channel (product has a real demo or teachable depth).
- Monthly refresh, or when the channel-strategy judge wants more YouTube evidence.

## Read layer — ScrapeCreators YouTube (via `scrape_creators`, never raw youtube.com)

All public-data, via `scrape_creators({ path: "/v1/youtube/...", query: { ... } })`:

- `/v1/youtube/channel`, `/v1/youtube/channel-videos`, `/v1/youtube/channel/shorts` — map who's already making content for this niche.
- `/v1/youtube/video` (details/stats — views/likes/comments) + `/v1/youtube/video/transcript` — **transcripts are gold**: mine what creators actually say + how the audience reacts.
- `/v1/youtube/video/comments` (~1k top + ~7k newer) + `/v1/youtube/comment/replies` — full comment-tree mining for buyer language, pain restatements, "where do I get this", competitor mentions.
- `/v1/youtube/search` + `/v1/youtube/search/hashtag` — find the niche's videos/channels/hashtags.
- `/v1/youtube/shorts/trending` — current Shorts formats/sounds worth riding.

Public metrics only — NOT Studio analytics (watch-time/retention/CTR are owner-only; infer from public views + flag as soft, per the Tier-2 caveat).

## What to mine (judgment, deep — not "top 5")

1. **Venue spread (ranked, big→long-tail).** Not one channel — a map: the big niche channels (reach) + the small high-intent ones (less competition, warmer audience) + the hashtags + the Shorts trends. Be present across the spread.
2. **Buyer language from comments + transcripts.** Verbatim pain, intent phrases ("is there a tool that…", "how do I…"), competitor gripes. These feed the buyer map + drafts.
3. **What's converting, not just what's viewed.** A 2M-view video with no buyer-intent comments is worse than a 5k-view one full of "where can I try this". Weight buyer-intent signal over raw views (and views are a soft proxy — say so).
4. **Format/title patterns that work in THIS niche** — for the Brief: Shorts hooks, long-form title structures (title = CTR lever), thumbnail angles, length.
5. **Style exemplars.** Capture 5-10 real, top-performing, HUMAN videos/titles/Shorts as few-shot anchors so Briefs match how this niche actually talks (per maya-voice-matcher).

## Output

Save findings as target threads (`save_target_thread({ platform: "youtube", ... })`) + channel-scorecard evidence + style exemplars + caption craft, same shapes as the other per-channel researchers — call the tool — a finding you describe in text but never save is lost. **Caption/title craft:** the YouTube **title is the CTR lever** (the gate to everything) — propose title options; the description carries SEO + the wrapped product link (in description, with timestamps). Shorts: hook in the first second.

## Discipline

- Judgment, no hardcoded thresholds. Signups-not-likes. Brief-only — never claim we film.
- Consult PLATFORM_ALGO.md for the current YouTube algorithm state before format/title calls.
- If YouTube doesn't earn a bet (no real buyer presence, or the founder can't produce video), say so honestly and park it — don't force it.
