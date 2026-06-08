# Instagram Sub-Playbook

Instagram is a **secondary channel** for most indie launches. Primary unless the operator's product is consumer-lifestyle / visual / creator-services. For B2B SaaS and dev tools, Instagram is reuse-only — repurpose what shipped on TikTok / LinkedIn.

Maya reads `PLAYBOOK.md` first. This file only contains Instagram-specific mechanics that override or extend the master doctrine.

---

## 1 — Reels-first reality

Instagram in 2026 is functionally Reels. The algorithm uses Reels as its user-acquisition engine and pushes them 3-5x harder than carousels. Static carousels are **secondary** but not dead — they win on engagement rate (10% vs Reels 6%), saves, and DM shares.

The split, per the Buffer 2026 algorithm guide and Adam Mosseri's stated signals (watch time / likes-per-reach / sends-per-reach):

- **Reels = reach engine.** Use for follower growth, new-audience exposure, viral catch.
- **Carousels = trust engine.** Use for saves, DM shares, deepening existing-follower relationships, conversion content.
- **Stories = retention engine.** Use to keep existing followers warm and to seed link clicks (the only IG surface with link friction-free for most accounts).
- **Single image posts** = dead. Don't make them as a content type; only use them for grid coherence if the operator cares.

### Decision rule IG-1.1

For an indie launch, Maya defaults to: **3 Reels / week + 2 carousels / week + daily Stories**. Reels above 3/week without volume of real material = slop; below 3 = insufficient algorithm signal.

---

## 2 — Reuse from TikTok (do not skip this)

The single biggest leverage move on Instagram for indie operators is: **reuse TikToks as Reels**. Reels-from-TikTok is the cheapest content the operator can produce.

### The reuse pipeline

- TikTok publishes → 24-48h later, repost to Reels.
- **Remove the TikTok watermark.** Reels algorithm visibly deprioritizes TikTok-watermarked videos. Tools: SnapTik, native re-export, or just record screen of TikTok play. Watermark-removal compliance varies; for the operator's own content this is fine.
- Re-cut captions for IG SEO: front-load the keyword phrase. Captions are the new hashtags. IG reads captions as search-index text.
- Adjust hook for IG audience: IG audiences are slightly older, slightly more aspirational than TikTok's. Less raw, more polished. But not corporate.
- Sound — keep TikTok's trending audio when reposting fast (within 48h); the trend often crosses platforms. If reposting after 1 week+, swap to an IG-native trending sound.

### What changes vs the TikTok caption

| TikTok caption | IG Reels caption |
|---|---|
| 1-2 lines, punchy hook | 3-6 lines, hook + context + keyword phrase |
| Casual emoji | Sparing emoji, 1-2 max |
| Hashtags inline at the end (3-5) | Hashtags inline OR first comment (3-5 max) |
| Native sound dominant | Native sound + caption text both load-bearing |

### Decision rule IG-2.1

If TikTok is the primary channel and TikTok posts are being produced, Maya **never** drafts net-new Reels content from scratch. Reuse first; net-new only when reuse pipeline is dry.

---

## 3 — When Instagram is primary

Instagram leads (not reuses) in these cases:

- **Consumer lifestyle product** with strong visual identity (fitness, fashion, food, home, wellness, journaling, dating).
- **Visual / aesthetic product** where the screenshot/output IS the product (design tools, photo apps, art tools, AI image generators with strong aesthetic outputs).
- **B2B-creator services** (productivity for creators, scheduling for creators, monetization for creators) — these creators are on IG and engage there.
- **Local or hyper-vertical service product** where word-of-mouth visual content matters.
- **Operator has a pre-existing IG audience >2k followers in the niche.** Use the existing audience; don't ignore it.

### Decision rule IG-3.1

If product is B2B SaaS / dev tool / API / infra → IG is reuse-only at most, frequently parked entirely. Don't waste cycles.

### Decision rule IG-3.2

If the operator's first instinct is IG but the channel-decision tree says LinkedIn / X, Maya flags the mismatch. Operator may have aesthetic preference for IG; that's a comfort signal not a product-fit signal.

---

## 4 — Carousel anatomy (10-slide format)

IG carousels in 2026 have a specific shape that works on IG and not TikTok. Different from TikTok's 6-slide slideshow.

### Slide-by-slide template for an indie launch carousel

1. **Hook slide.** Big text, single sentence. The promise OR a contrarian claim. Example: "I built a tool that watches your competitors so you don't have to."
2. **Setup slide.** Why this exists. The pain. 2-3 lines.
3. **The reveal slide.** What the product is, in one sentence. Specific outcome named.
4. **Proof slide #1.** Screenshot of product in use.
5. **Proof slide #2.** A specific number / before-after / metric.
6. **How it works slide.** 3 steps max. No more.
7. **User-quote slide.** Real DM screenshot or testimonial. If none exists, skip and go to 8.
8. **Counter-objection slide.** "But isn't this just [X tool]?" → real answer.
9. **Use-case slide.** "Best for: [specific persona] who [specific situation]."
10. **CTA slide.** "DM 'launch' if you want in" OR "link in bio." Soft CTA, never aggressive.

### Decision rule IG-4.1

Carousel slides 1, 5, and 10 do the work. If those three aren't strong, reorder until they are. The middle slides exist to keep the swipe-through alive — they must be skimmable.

### Visual rules

- Vertical 9:16 OR square 1:1. Vertical preferred for 2026 algo signal alignment.
- Max 8-12 words per slide. Carousels are scanned, not read.
- Consistent visual identity slide-to-slide. Same font, same color, same alignment.
- Slide 10 always has a clear CTA. If unclear, the operator is leaving conversion on the table.

---

## 5 — Hashtag doctrine (de-prioritized but not dead)

Hashtags are no longer the lead distribution mechanic. **Captions are.**

### What works in 2026

- **3-5 highly relevant hashtags.** Not 30. The 30-hashtag spray reads as spam to the algorithm.
- **Mix of size.** 1 big (1M+ posts), 2 mid (100k-1M), 2 niche (<100k).
- **Niche-specific over generic.** `#indiehackers` > `#startup`. `#vibecoders` > `#tech`. Specificity is the lever.
- **Hashtags in the first comment** is fine — algorithm reads both equally per current consensus.

### What doesn't work

- 30 hashtags. Banned by signal-quality rules in the algo.
- Repeating the same hashtag set every post. Algorithm penalizes pattern-spam.
- Branded hashtags with <10 posts. Pointless until the operator has scale.
- Trending hashtags unrelated to the post. Reads as spam, gets demoted.

### Captions as the new hashtags

The first 1-2 sentences of the caption are weighted heavily by the algorithm for topical search. Front-load:

- **The keyword phrase.** "AI launch teammate for indie hackers" is a phrase IG can index. "🚀 Excited to share..." is not.
- **A specific outcome / benefit.** "Saves 3 hours/week on social media" indexes better than "boost your productivity."
- **One concrete noun** the audience searches for. "Vibe-coded apps" / "first 100 users" / etc.

### Decision rule IG-5.1

Maya treats the first sentence of every IG caption as the SEO title. Treats hashtags as 3-5 niche tags. Anyone diverging from this is using a 2020 strategy.

---

## 6 — DMs as commerce channel

IG DMs are the highest-conversion surface on the platform for indie launches. Sends-per-reach is a 2026 ranking signal — when content gets shared via DM, IG promotes it further.

### Tactics

- **DM CTA in carousel slide 10.** "DM 'launch' to get the link." Forces a DM, opens a conversation, builds the conversion thread.
- **DM auto-reply for waitlist.** If the operator has IG-business setup, configure an auto-reply to specific keywords.
- **Reply to every DM personally for first 100.** This is the hand-craft phase. The single highest-leverage thing the operator does.
- **Sends-via-DM is a ranking signal.** If a post is being DM'd to friends, IG amplifies it. Encourage shares explicitly: "Send this to a friend who's launching something."

### Decision rule IG-6.1

If the operator is doing IG seriously, the DM funnel is the conversion path, not the bio link. Bio link is for cold discovery; DM is for warm conversion.

---

## 7 — Story sequencing

Stories are the daily-presence layer. They don't drive new audience; they retain and convert existing audience.

### Launch-week Story sequence (daily, 3-5 stories/day)

- **Morning story:** What I'm working on today. Specific. "Today: shipping the Stripe webhook for failed payments."
- **Mid-day story:** Behind-the-scenes — screen recording, code snippet, blooper, customer DM screenshot (with permission).
- **Afternoon story:** A teaser / poll / question to existing followers. Polls drive Story engagement signal.
- **Evening story:** Reshare today's Reel / carousel with a personal note. Drives the post higher in non-followers' Explore via warm-signal.

### Decision rule IG-7.1

Stories without engagement (taps, replies, poll votes) are wasted. Maya inserts at least one interactive element per day — poll, question sticker, slider, quiz, or DM ask.

### What not to put in Stories

- Pure repost of a feed post without commentary. Algorithm sees as low-effort.
- Long blocks of text without visual element. Stories are visual-first.
- More than 5/day. Above 5 → followers tune out, completion rate drops, algorithm punishes.

---

## 8 — Decision Rules (Instagram)

- **IG-8.1** IF product is B2B SaaS / dev tool / API / infra THEN IG is reuse-only or parked.
- **IG-8.2** IF TikTok is shipping content THEN reuse to IG within 48h. Net-new IG content only when TikTok dry.
- **IG-8.3** IF Reels-to-feed ratio drops below 3 Reels / 2 carousels / week THEN reach signal degrades; recommend volume.
- **IG-8.4** IF carousel has fewer than 8 slides OR more than 12 THEN re-cut. 10 is the sweet spot.
- **IG-8.5** IF post uses >5 hashtags OR fewer than 3 THEN rebalance to 3-5 niche-specific.
- **IG-8.6** IF caption opens with "Excited to announce" / "Thrilled to share" / emoji rocket THEN rewrite.
- **IG-8.7** IF first sentence of caption doesn't contain the keyword phrase THEN rewrite for IG SEO.
- **IG-8.8** IF Reels reused from TikTok still has TikTok watermark THEN remove before posting.
- **IG-8.9** IF DM CTA missing from carousel slide 10 THEN add it; missing DM funnel = leaving conversion on table.
- **IG-8.10** IF Story sequence has zero interactive elements (polls, questions, sliders) THEN add at least one per day.

---

## Sources

- IG Algorithm 2026: https://buffer.com/resources/instagram-algorithms/ · https://later.com/blog/how-instagram-algorithm-works/ · https://sproutsocial.com/insights/instagram-algorithm/ · https://www.dataslayer.ai/blog/instagram-algorithm-2025-complete-guide-for-marketers
- Reels vs Carousels: https://fluxnote.io/guides/instagram-carousel-vs-reels-performance-2026 · https://storrito.com/resources/how-instagram-carousels-beat-reels-for-engagement-in-2026-and-when-to-use-each/
- Hashtag + caption SEO: https://lamplightcreatives.com/captions-vs-hashtags-instagram-2026/ · https://metricool.com/instagram-seo/ · https://usevisuals.com/blog/proven-instagram-seo-2026-optimizing-bio-and-captions-for-search
