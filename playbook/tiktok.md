# TikTok playbook — for solo / indie founders launching a product

This file is Maya GTM's source of truth for every TikTok decision: whether to recommend the channel at all, which format to script, what hook to write, when to tell the user to wait, and what to never let them do.

Maya does not auto-post to TikTok in V1. She scripts. The user posts. Treat that as a hard constraint, not a temporary limitation — it shapes every recommendation downstream.

If a claim below is not backed by a public source, it is prefixed `(unverified, common wisdom)`. Everything else is cited in the Sources section at the bottom.

---

## 1. Why TikTok for indie launches (and why not)

### The distribution advantage

TikTok is the only major social platform where a 0-follower account can reach 100K+ views on its first post on merit alone. The For You Page is interest-graph-driven, not follower-graph-driven. ~96% of total watch time on TikTok comes from the FYP, not from following-feed scroll [Buffer, Hootsuite]. ~90%+ of views on any given video are from non-followers [go-viral.app].

How distribution actually works: the algorithm seeds every new video to a small test cohort (~100–500 users) in the first 3 hours, measures completion rate + engagement signals, and either kills it or expands the cohort. The cohort expands geometrically: 500 → 5K → 50K → 500K, gated at each step on retention holding.

**Receipts that this is real for indie launches:**

- **Cal AI** (calorie-tracking app) — $1.5M MRR in 34 days, attributed to faceless TikTok explainer videos showing the camera-scan-food feature. No founder on camera, no paid influencers. [TokPortal, ScreensDesign]
- **Daze Chat** (Gen-Z messaging app) — 26.4M TikTok views *before* launch. @daze.chat hit 31M+ views across 7 months of one-faceless-screen-recording-per-day. [Domus, growwithplutus.com]
- **PushScroll** ("do pushups before you can doomscroll" app) — Alejandro Sanchez (@skyirezumi) posted a single fake-demo TikTok of an app that didn't exist yet, got 80K views, hundreds of comments begging him to build it, then built it. $30K/month four months later, 300K downloads. [Medium / Classy Endeavors]
- **Stronger** (gamified workout tracker) — Co-founder Jack made a Canva prototype video on TikTok before the app existed. It took off. The team later cracked a "fade-in" format (6-sec, black-to-image) and ran ~300 micro-variants for an estimated 200–300M cumulative views. $600K ARR, 1.2M users. [Superwall]

These are *not* outliers because of the founder. They are outliers because the product was *showable* and the format respected platform native grammar.

### The showability filter (decision gate)

TikTok rewards visual / demo-able products. It ignores invisible products. Maya should screen for this before ever recommending TikTok as the primary channel.

A product is **showable** if at least one of these is true:
- It has a *visible UI moment* that can be screen-recorded in <10 seconds and explained without audio (Daze: chat bubbles morphing into art; Cal AI: camera scanning a sandwich; Pushscroll: pushup overlay blocking Instagram)
- It has a clear *before / after* that fits in one frame (Stronger: skinny → strong; resume tools: bad resume → good resume)
- It produces an *output object* that's interesting on its own (image generators, voice clones, AI-edited videos, code-gen apps)

A product is **un-showable** if all of these are true:
- The value is server-side / API-only (a webhook router, a queue, a deliverability tool)
- The "demo" is a dashboard with numbers in it
- The buyer cares about reliability / SOC2 / cost — not the visible feature

**Rule:** If the product is un-showable AND the user can't or won't do slideshow Photo Mode, **do not recommend TikTok at all.** Send them to X (build-in-public), LinkedIn (B2B), or YouTube (long-form demo).

### The faceless / face / slideshow trichotomy

Three viable formats. Most failing indie accounts pick the wrong one for their constraints.

- **Faceless screen-recording (highest ROI for app demos).** Use when the product is the star. Default for app launches. Cal AI / Daze / Pushscroll all run this. The founder never appears.
- **Founder talking head.** Use when the product is a story (build-in-public, niche-coaching tool, agency offer). Higher trust ceiling but higher production friction. Easy to do badly.
- **Slideshow / Photo Mode (carousel).** Use when (a) the product is un-showable but interesting as concepts/text, or (b) the founder won't record video, or (c) the niche over-indexes on text on screen (B2B, finance, dev tools). TikTok reports carousels get 1.9× more likes, 2.9× more comments, 2.6× more shares than video [Socialinsider, TokPortal]. Worth confirming this number for the user's niche before betting on it.

### When TikTok is the WRONG channel

Maya should recommend *against* TikTok when:
- The product is enterprise B2B with $500+ ACV and a months-long buying cycle. The buyer is there (30+ adults are TikTok's largest cohort now [Conbersa]) but the purchase doesn't get triggered by a 30-sec video. Use TikTok as awareness-only or skip.
- The product can't be shown, the user can't do slideshow, and they refuse founder-on-camera.
- The user's account is freshly created (<14 days) AND they want to launch *this week*. Tell them to warm up first or pick a different channel (see § 6).
- The user's product targets people who don't watch TikTok in the buying mindset: high-end enterprise IT, regulated finance, anyone with corporate procurement.
- The user has zero time to script + post manually. V1 has no auto-poster (see § 12). If they won't do the manual work, recommend a channel Maya can post to.

---

## 2. The first-1.2-seconds hook framework

TikTok users decide whether to keep watching or swipe in ~0.4 seconds [TikTok World 2025, via Conbersa]. The first 1–2 seconds are the hook. Completion rate is the dominant ranking signal, weighing roughly 2× any other engagement metric [Opus.pro, go-viral.app]. A target floor for new content is 65% retention at the 3-second mark; below that, the video gets killed in cohort testing [Opus.pro].

A hook does three jobs simultaneously:
1. **Motion or contrast** — something visibly changes in the frame, breaking scroll inertia.
2. **Promise statement** — text or VO tells the viewer exactly what they will see or get.
3. **Search-friendly phrase** — front-load a keyword. TikTok is increasingly a search engine [Hootsuite, Sprout Social]. The hook text doubles as SEO.

### Catalog of hook formats (Maya picks from these when scripting)

**a. Pattern interrupt**
- Shape: visible jarring moment in frame 1. Loud sound, unexpected prop, sudden text on screen.
- VO/text: "Wait. This is broken." / "Stop scrolling — your <thing> is wrong."
- Use when: product is provocative or contrarian. Risky for new accounts; pattern interrupt + zero authority reads as bait.

**b. Outcome promise**
- Shape: number on screen in second 1. Photo of the result.
- VO/text: "I made $10K with one TikTok." / "I cancelled my $50/mo gym with this app."
- Use when: outcome is concrete + believable. Avoid if you can't substantiate; TikTok comment culture eats unsupported numbers.

**c. Question hook**
- Shape: blunt question, often combative.
- VO/text: "Why is everyone using <competitor>?" / "Why does <category> still cost $200?"
- Use when: the product positions against an incumbent. Curiosity-gap-heavy [Opus.pro].

**d. Demo cold-open**
- Shape: no intro. Frame 1 is the user opening the app. Voiceover starts mid-action.
- VO/text: "Watch this." (and then just do the thing)
- Use when: the UI moment is self-explanatory in 2 seconds. Daze runs this constantly.

**e. Pain validation**
- Shape: name a specific behavior the viewer just did.
- VO/text: "If you keep checking Instagram before coffee, you need this." / "If you've ever asked ChatGPT to write a cover letter — this is better."
- Use when: the niche has a shared, slightly-shameful pain. Pushscroll lives here.

**f. Proof-first**
- Shape: lead with a credential, a screenshot, a result.
- VO/text: "I built this in 4 days. It has 10K users now." / "300K downloads later, here's how it works."
- Use when: you actually have proof. Reads as bragging without it.

**g. POV / situational**
- Shape: "POV:" on screen, or a contextualizing setup.
- VO/text: "POV: you just shipped a side project and no one's downloading it."
- Use when: the niche over-indexes on POV (Gen-Z, fitness, dating). Less good for B2B.

**h. Bold contrarian claim**
- Shape: stating something most viewers think is wrong.
- VO/text: "ChatGPT is bad at writing code. Here's what's actually good."
- Use when: you can defend the claim within 8 more seconds. Otherwise it's bait.

**i. Before / after teaser**
- Shape: frame 1 is "before"; transition reveals "after" by second 3.
- VO/text: minimal. Let the visual do the work.
- Use when: the product produces a transformation that's legible without context (resume, image, code, body, room).

**j. Comment / DM bait (use sparingly)**
- Shape: text overlay anticipates the viewer's reaction.
- VO/text: "You're about to comment 'this is fake.' Watch first."
- Use when: you have a counterintuitive product. Risky — TikTok suppresses content that feels engagement-baity.

### Hook scripting rules (Maya enforces)

- The hook is **everything before second 2**. Write it first, then write the rest.
- No "Hey guys" / "Welcome back" / "What's up everyone" — these are guaranteed drop-offs in the first second. Banned for founder-talking-head format.
- Hook text on screen should be readable in <0.6 seconds. ≤7 words.
- Show motion or contrast in frame 1, even if it's just a hand entering frame, a phone tilting, a UI tap.
- If the product is the hook, hold the product on screen by second 2. Don't bury it.

### (unverified, common wisdom): Hook polish heuristic

Slightly rough, real-person-shot content consistently outperforms polished ad-style content for indie launches. Overproduction reads as "this is an ad." Authenticity reads as "this is a real person." Maya should never tell a user to add a logo intro, lower thirds, or motion graphics in their first 20 videos.

---

## 3. Format anatomy — faceless demo (default for app launches)

**This is Maya's default recommendation for an indie shipping a showable app.** Cal AI, Daze, Pushscroll all built their launches on this format.

### Setup

- iPhone screen recording (Control Center → Screen Record). Mac screen recording works but loses the phone-native UI texture that performs better for app demos.
- Record at native resolution. Don't downscale.
- Aspect ratio: **9:16, 1080×1920**. Never letterbox. Never post 16:9 — TikTok will deprioritize. [Manychat, AspectRatioCalculator]
- Voiceover: **record after** the screen capture, not during. Live voiceover always has dead air, breathing, "umm" — kill all of it in post. Use CapCut's free voice-to-text + record-to-clip for trim.
- Music: trending audio at low volume (~10–15%) under the VO. See § 10 for sound strategy.

### Safe zones (critical — TikTok UI overlays the bottom 250px and right 130px)

Place every text overlay, every CTA, every key UI moment within the central safe zone: roughly 900×1400px, centered. Specifically [Manychat, HouseofMarketers]:
- ≥150px from the top
- ≥250px from the bottom (the like / comment / share buttons sit here)
- ≥130px from the right (caption + CTA panel)

If a text overlay or CTA sits outside this zone, viewers don't see it. Maya should remind the user when generating scripts that include on-screen text.

### Length sweet spots [Opus.pro, go-viral.app, shortimize.com]

- **15–30s** — hook-discovery videos. Best for hitting the high-velocity test cohort. Use for the first 10–15 launch posts.
- **31–60s** — generates the most absolute watch time + algorithmic reward when retention stays above 60%.
- **60–90s** — storytelling, deep build-in-public, multi-feature demos. Only use after the account has 5+ green posts (>5K views each).

**Rule:** Completion rate beats absolute length. 30s @ 70% completion crushes 3min @ 15%. When in doubt, cut the video shorter than you think. Maya should aim for 22–28s on default app-demo scripts.

### Caption + on-screen text rules

- On-screen text duplicates the VO of the hook for sound-off viewers. ~85% of social video is watched without sound initially [HouseofMarketers]. Captions add ~40% retention [Meta data, via HouseofMarketers].
- Keep on-screen text to <7 words per beat. Update text every 1.5–2 seconds.
- Caption (the text that appears under the video, by your username): 1–2 sentences, conversational, includes one specific keyword. Avoid hashtag stuffing — 3–5 hashtags max [Sprout Social, Metricool]. One broad niche tag (#productivity), 2–3 niche-specific (#pomodoro #studytok), 1 trending if relevant.
- **Never** type "link in bio" in the caption. TikTok filters the literal strings "link" and "bio" in comments [Stan.store, Morgan Digital]. Whether it suppresses video reach is contested but enough creators report it that Maya should treat it as "avoid by default." Use "DM me 'app'" or a pinned-comment URL instead (see § 8).

### CTA placement

- End-of-video CTA: text-on-screen + VO. ≤3 seconds.
- Don't say "follow for more" in the first 70% of the video — algorithm reads this as engagement bait [SocialMediaToday].
- The strongest CTAs for indie launches: "Comment '<word>' and I'll send you the link" (manual reply with link, OR uses TikTok's auto-DM if the user has a Business Account + Manychat-style tool) / "It's [App Name]. Search the App Store." (deflects to search, which TikTok actually rewards because viewers stay in the app a beat longer than they would clicking out).
- **(unverified, common wisdom):** Never say "link in bio" verbally. Say "the app is called <name>, look it up" or "I'll pin the link in comments."

### 5 verified faceless indie demos to learn from

(Maya: when scripting, reference these structures. Don't recommend the user copy the *content* — copy the format.)

1. **@daze.chat** (https://www.tiktok.com/@daze.chat) — One-per-day cadence, ~31M+ views over 7 months. Every video: screen recording of two phones texting in the Daze app, hook = "POV: you sent your crush this." All faceless, no founder ever appears. [Domus, growwithplutus.com]
2. **@skyirezumi (Pushscroll)** — The original viral "fake demo": https://www.tiktok.com/@skyirezumi/video/7513681195717217558 ("Our app where you have to do pushups before scrolling social media is finally out!"). [Search results confirm]
3. **@skyirezumi (Pushscroll) launch-day update** — https://www.tiktok.com/@skyirezumi/video/7514096929836502294 ("4000 new Users on day ONE"). Proof-first hook with a number.
4. **Cal AI** — Multiple creator-posted faceless demos showing the food-camera moment. Search "Cal AI" on TikTok; the format is identical across creators: open app → point at food → calories appear. The format is the product. [TokPortal, ScreensDesign]
5. **@strongermobile** — Their "fade-in" format: a 6-second black-to-image transition that's been variant-tested ~300 times for cumulative 200M+ views. [Superwall]

---

## 4. Format anatomy — founder talking head

Use when the product *requires* trust or context that a faceless screen-record can't deliver. Build-in-public threads, niche coaching tools, agency-style offers, anything where "who built this" matters.

### Setup

- Front-facing camera, vertical (9:16). Phone clamp / tripod beats handheld; handheld reads chaotic past a few seconds.
- Eye level. Camera at chin-height = double-chin angle. Camera above eye-line = subordinate angle. Both lose retention.
- Soft, even lighting from in front. Ring light is fine. Window behind you is a death sentence (silhouette = drop-off).
- Audio: phone mic is OK if you're <2 ft from the camera. Otherwise a lavalier. Bad audio is the #1 founder-talking-head retention killer.

### Hook structure for talking heads

Two patterns work:
- **Face-first**: founder is on screen in frame 1, talking already. The first words ARE the hook. Works for confident, telegenic founders. "I just shipped my first app and it has 4000 users in 24 hours" → flash to the dashboard.
- **Text-first**: full-screen text overlay in frame 1 (no founder visible yet), then cut to founder by second 2. Works for less-confident founders. The text carries the hook, the face delivers the body.

(unverified, common wisdom): If the founder's face would *reduce* the hook (they read tired, they're in a messy room, they hesitate), use text-first.

### Content categories that work for indie founder talking heads

- **"Just shipped"** — single-video launch announcement. Hook = the number (downloads, MRR, signups). Demo within. CTA = look it up by name.
- **Daily build** — micro-devlog. "Day 12 of building <X>." Works if the product itself is interesting; deadly if not. Don't recommend daily-build for invisible-API products.
- **Reflection** — "I built this app and no one used it. Here's what I learned." High share rate, low conversion rate. Use sparingly. Good for personal-brand spillover, bad for product launch.
- **Reaction / commentary** — duet or stitch another creator's video. Lowest production cost. Best for getting initial views on a cold account because you piggyback an existing video's distribution.
- **Tutorial** — "How I built <X> in 24 hours." Mid-conversion but high save rate. Build trust before pitching.

### Pacing rules

- No dead air >0.5 seconds. Cut every breath, "umm," pause. CapCut + auto-cut works.
- Cuts every 1.5–3 seconds. New angle, new B-roll, new text overlay, or jump cut.
- Hand gestures in frame help retention. Hands out of frame = static = drop-off.
- (unverified, common wisdom): The founder should look slightly to the side of the camera, not dead-center down the lens. Direct eye contact in vertical short-form reads aggressive.

### 5 verified founder-led indie videos

(Less common pattern for indie launches than faceless. The most-cited examples are personal-brand creators, not product launches.)

1. **@skyirezumi (Alejandro Sanchez)** — Mixed format. Founder appears in some videos, hands-only in others. https://www.tiktok.com/@skyirezumi/video/7589285765192928534 ("Would you use this app?") — testing-the-concept format with founder voice. [Search-confirmed]
2. **@levelsio** — https://www.tiktok.com/@levelsio — Pieter Levels. Low view count on TikTok specifically (he optimizes X), but the format is reference-grade for build-in-public talking head. [Search-confirmed]
3. **Marc Lou** — Primarily X / YouTube, not TikTok, but his "founder demo" video pattern (parody scene with his product photoshopped in) is widely-imitated. [Suraj Kadam / IndieHackers]
4. **Stronger co-founder Jack's Canva prototype video** — Specific URL not surfaced in search results but cited in Superwall case study as the inception viral. [Superwall]
5. **Jenna Labiak (founder, silk product)** — First TikTok went to 600K likes, 3.5M views. Founder-on-camera format, product reveal. [Fourthwall]

---

## 5. Format anatomy — slideshow / Photo Mode / carousel

TikTok Photo Mode lets you post up to 35 still images in a swipeable post with music or voiceover. TikTok's own data: carousels see 1.9× likes, 2.9× comments, 2.6× shares vs video posts [Socialinsider, TokPortal]. This is the cheat code for un-showable products and for founders who refuse to record video.

### The 6-slide structure that actually works for launches

Default skeleton Maya should ship as a starting script:

1. **Problem** — text-only, big-font, one sentence. "Your portfolio site looks like 2008."
2. **Context / specificity** — show *who* this is for. "If you're an indie dev with a half-built side project…"
3. **Twist / contradiction** — flip the assumption. "…you don't need a designer."
4. **Demo / proof** — screenshot of the product, the output, the before/after.
5. **Outcome** — concrete result, screenshot, number. "10 min from this → that."
6. **CTA** — name of the product, search instruction. "It's called <X>. Look it up."

(unverified, common wisdom): The first slide should have one bold visible word that promises what swiping will deliver. Slide 1 = the hook.

### Visual rules

- Native TikTok text-on-image overlay (not Canva-flat). Photo Mode auto-applies TikTok's font and motion if you use the in-app editor. Templates from outside Canva work but read as polished — for indie launches, native is more authentic and performs better.
- High contrast. Black text on white card or white text on dark photo. No mid-grays.
- One idea per slide. The viewer is reading + swiping in <2 sec per card.
- Aspect ratio for each image: 9:16 (1080×1920). Square images get letterboxed.

### Music selection

- Trending audio at low volume under the swipe (Photo Mode is auto-musical).
- Or original voiceover narrating each slide as it appears.
- For B2B / commercial accounts that need to use Commercial Music Library: pick something with a slow, neutral feel — energetic CML tracks read very "stock." See § 10.

### 5 verified slideshow / Photo Mode launch references

Specific viral indie-launch slideshows are harder to surface in search than viral video demos. Verified patterns:

1. **Canva on TikTok** — Used Photo Mode to share their own process of adding elements to a presentation. Standard B2B demo pattern. [Socialinsider]
2. **Educational listicle pattern** — "7 tools every <niche> needs in 2026" — each tool on its own slide. This is the most-cited successful carousel pattern for B2B SaaS [Socialinsider, TokPortal]. Maya should default to this for indie devs with a tools-list product or comparison angle.
3. **Step-by-step tutorial pattern** — "How to ship a side project in 24 hours" — one step per slide. Strong save rate, which TikTok ranks high. [TokPortal]
4. **Industry-report-to-insight pattern** — "We analyzed 1000 indie launches. Here are 5 patterns." 3–5 key findings, one per slide. Works for data-rich products. [Socialinsider]
5. **Before / after carousel** — slide 1 = before, slide 2 = after, slides 3–5 = process. Best for transformation-driven products (resume, portfolio, fitness, design tools).

---

## 6. Account warm-up doctrine

**This is the #1 thing indie founders get wrong.** They sign up for TikTok, post their launch video that day, get 47 views, and conclude TikTok doesn't work. TikTok aggressively suppresses brand-new accounts that immediately post commercial / promotional content [Hypefury, Multilogin, Shopify, KOLHUB].

The ClawLaunch codebase already encodes this — `convex/gtmMaya/tiktokWarmup.ts` returns `status: "warmup_required"` for accounts <7 days old, with no profile, or unchecked Account Status. Maya should never override that gate.

### The warm-up sequence (Maya's default for any user whose account is <14 days old or `tiktokWarmupState !== "ready"`)

**Days 1–3: Lurk + signal niche**
- Open TikTok. Watch full videos in the target niche. **Don't skip.** Each full-watch is a signal to the algorithm about what your account is "about."
- Follow 15–25 real accounts in the niche.
- Like 20–30 videos. Comment authentically on 3–5 (real thoughts, not "great content!"). [Multilogin, Hypefury]
- Save 5–10 videos that exemplify the format you'll later replicate.
- **Do not post anything.** [Multilogin: "wait two to three days before posting"]

**Days 4–7: 1 post/day of NICHE-consumption content (not product-related)**
- Post once a day, of content adjacent to your niche but NOT promoting your product yet.
- Example for a dev-tool founder: a video reacting to a viral tech tweet, a quick demo of *someone else's* tool you use, a "tools I use as an indie dev" listicle.
- This signals: "this account is about dev tooling," not "this account exists to spam its own product."
- Check **TikTok Studio → Account Check** at end of day 7. If anything is yellow/red, pause for 48h and re-check.

**Days 8–14: 1–2 posts/day. First product mention at a 1-in-5 ratio.**
- Continue 80% niche-consumption content.
- 20% of posts can begin mentioning the product (in a value-led way — show the problem the product solves, mention it in passing).
- No hard-sell launch posts yet.

**Day 14+: Launch cadence (2–3 posts/day)**
- Account is now "warmed." Begin the actual launch sequence with hero videos (faceless demo or slideshow).
- 2–3 posts per day max [Hypefury: "1–4 videos per day and ramp up gradually"]. Going from 0 to 20 posts overnight is the #1 trigger for shadow-ban [Shopify, Manychat].

### Evidence that warm-up matters

- TikTok flags accounts showing sudden posting spikes as spam [Shopify].
- Shadow-bans on TikTok typically last 3–14 days, can stretch to ~1 month if re-triggered [Manychat, Proxidize].
- Tools that mass-follow, mass-comment, or post identical captions across multiple posts are flagged [AIVideoCut, Sendshort, Multilogin].
- (unverified, common wisdom): VPN-from-server-room + brand-new SIM + brand-new device installed within 24h of first launch post is the indie-launch demographic version of "obviously a bot." Don't recommend it.

### The "post immediately" failure mode

If a user insists on posting their launch video on day 1: **Maya should tell them this is the most likely cause of their video flopping**, and give them the warm-up sequence as the explicit alternative. Their `tiktokWarmupState` in the schema should remain `new_needs_warmup` until they complete the day-7 Account Check.

---

## 7. Niche-format mining (the core ClawLaunch research tactic)

This is what Maya does best. Find what's working in the user's niche RIGHT NOW. Replicate the FORMAT, not the content.

### The methodology

1. **Identify 3–5 target keywords / hashtags for the user's niche.** "indie hacker", "side project", "ai app", "productivity hack", or whatever maps to the product.
2. **Search TikTok for each.** Sort by view count where possible (search → switch to keyword search → look at "Top" tab).
3. **Catalog the top 20 videos per keyword.** Pull: hook structure, format (faceless / face / slideshow), length, on-screen text style, music style, CTA pattern.
4. **The 5-video rule**: if 5+ of the top 20 share a hook structure (e.g., "POV: you're a junior dev and…", or "before / after with a fade"), that IS the niche-native format. Use it.
5. **Format remix doctrine**: keep the same hook structure, swap your product in. Don't copy the literal content — copy the skeleton.

### ScrapeCreators endpoints to surface this (the user has these wired)

- **`/v1/tiktok/hashtags/popular`** — popular hashtags by time period / region [docs.scrapecreators.com]. Use this to find what hashtags are trending in the user's niche.
- **`/v3/tiktok/profile/videos`** — pull a competitor's recent videos to study their format. Pass `handle=<competitor_handle>`.
- **TikTok keyword search** — ScrapeCreators wraps the TikTok keyword search endpoint; Maya should use this to surface "top 20 by keyword" for each niche term.
- **TikTok video search by hashtag** — same idea, by hashtag rather than keyword.
- **`/v1/tiktok/videos/popular`** — popular videos in a region / time window. Lower signal than keyword search but useful for "what's the meta trending format right now."

### Format-remix examples Maya should reference

- If the niche is "productivity apps" and the top videos are screen recordings with a stark before/after transition, the remix is: screen recording of YOUR app, with the same stark before/after transition, narrating YOUR feature.
- If the niche is "AI tools" and the top videos are POV slideshows ("POV: you discover this tool"), the remix is: POV slideshow about discovering YOUR tool.
- If the niche is "dev tools" and the top videos are talking-head founders explaining their stack, the remix is NOT a slideshow. Mismatch = drop-off.

**Rule**: Never recommend a format that isn't already winning in the user's niche, unless the user has 10+ successful posts and is consciously experimenting.

### Cloning the winner directly (Studio tier — `maya-video-producer`)

When the niche-native winning format is a **video** and recurrence is confirmed (the 5-video rule), Maya doesn't just remix the skeleton into a text draft — on the **$149 Studio tier** she produces the founder a real video *in that exact winning format* with their product in it. The winning video's URL (captured by `maya-tiktok-format-researcher`) becomes the `referenceVideoUrl` for `clone_winning_ad`, grounded in the founder's real screenshots (`imageAssetIds`). This is the strongest expression of "copy the format, not the content" — the founder's product, rendered in the niche's proven winner. (Non-Studio accounts get the text/slideshow remix instead; the video tools are server-gated.) See `maya-video-producer` for the mode choice (clone vs originate) and the grounding firewall.

---

## 8. Comment-to-DM funnel (the link-suppression workaround)

TikTok has no programmatic auto-DM for unverified Personal accounts. Hosted apps can't legally automate DMs at scale (TikTok blocks this as spam) [Stan.store, AIVideoCut]. The phrase "link in bio" gets filtered in comments [Morgan Digital, Stan.store]. So Maya must script around all of this.

### What Maya should tell the user to do (in order of effectiveness)

1. **Pin a comment with the URL.** Comments support clickable links — captions do not. The user posts their video, then immediately writes the first comment from their own account containing the product URL, then long-presses → pins. Viewers tap the comment, then tap the URL. [feedguardians.com, social.colostate.edu]
2. **"Comment '<word>' and I'll send you the link"** — manual reply to comments with the link. Slow but reliable. If the user has a Business Account + Manychat-style tool (not part of V1 ClawLaunch but a future option), this can be automated.
3. **Search-by-name CTA** — "It's called <product name>. Search it." Best for products with discoverable names in App Store / Play Store / Google. Highest conversion for app-store-listed products because TikTok rewards viewers staying in-app a beat longer than clicking out.
4. **Bio link, never named directly** — the user's bio has the URL (any TikTok Personal account can have a clickable bio link as of mid-2024 [Stan.store, UniLink]). The video never says "link in bio." Instead: "go to my profile" or just visual point-up at the username area.
5. **Reply-to-comment-with-video** — when a viewer asks "where do I get this?", the user records a tiny video reply with the answer. This both deepens engagement AND creates a new piece of content that piggybacks the original video's distribution. [TikTok Newsroom on Reply-to-Comments-with-Video]

### The follow-up-comment tactic

After posting, the user comments on their OWN video with: "if anyone wants the link, search '<product name>' or DM me." This:
- Gives a CTA without putting it in the caption
- Surfaces in the comment feed (high-visibility position if pinned)
- Doesn't trigger the "link in bio" filter

### Things Maya should NEVER recommend

- Buying TikTok "auto-DM" tools that promise to send links via DM at scale. These trigger spam detection [AIVideoCut, Sendshort]. Banned in the ClawLaunch playbook.
- Posting the same link in the comments of competitor / unrelated videos. Instant shadow-ban trigger [Hypefury, Multilogin].
- Repeating the literal string "link in bio" verbally OR in caption. Filtered by TikTok in 2024+ [Morgan Digital, Stan.store].

---

## 9. Anti-spam / shadow-ban triggers (Maya's fail-closed list)

The For You Page is opaque. TikTok does not publish a shadow-ban list. The following are the confirmed-by-multiple-sources triggers Maya should treat as fail-closed (never recommend an action that hits any of these).

### Confirmed triggers

- **Same caption template across multiple posts** — algorithm flags as spam [Hypefury, Multilogin, Octobrowser]. Always vary captions.
- **Posting frequency spikes** — going from 1/day to 20/day overnight [Manychat, Shopify]. Cap recommendations at 2–3/day for new accounts; 4/day max for warmed accounts.
- **External link in the video caption (not bio)** — captions never accept clickable links and pasting raw URLs in captions is a low-grade spam signal [social.colostate.edu, Stan.store].
- **Banned/sensitive words in caption or hook** — LGBTQ terms, anything about sexual content, drug references, dangerous-act references can suppress the entire video [VVITCH Digital, TikTok Community Guidelines]. Maya should run any user-supplied script through the LangSafe heuristic (avoid: "sex", "kill", "drugs", "suicide", "lesbian"/"gay" when not the topic — these can soft-filter content). [Note: this list is not exhaustive, TikTok's filter is opaque, and context matters.]
- **Mass-follow / mass-unfollow / mass-like / mass-comment** — automation patterns [Hypefury, Multilogin, Proxidize].
- **Identical comments across multiple videos** — "great post!" copy-pasted reads as bot [Multilogin].
- **VPN + brand-new device + brand-new SIM + immediate commercial post** — new-account fingerprint signals [Multilogin, Octobrowser].
- **Reused video files** — re-uploading a video TikTok has already seen (yours or someone else's) is reduced reach [Hypefury].
- **Re-posting after a delete-and-repost** — algorithm penalizes [Octobrowser].
- **"Engagement bait" phrases** — "follow for more," "like if you agree," "comment 'X' for the link" can soft-suppress if used heavily [SocialMediaToday].

### What Maya should ALSO encode (already in `tiktokWarmup.ts`)

- `canPostTikTokManually !== true` → block all TikTok recommendations. V1 has no auto-post.
- `tiktokWarmupState === "restricted"` → block all posting recommendations until the user resolves the TikTok Studio Account Check.
- `tiktokAccountAgeDays < 7` OR `tiktokAccountStatusChecked !== true` → recommend the warm-up sequence (§ 6), cap posting at 1–2 per week.
- Otherwise (`ready` state) → up to `maxWeeklyVisualPosts` (default 3, can scale to ~14 for warmed accounts).

### Shadow-ban recovery (if user reports flat reach)

If a user reports a sudden drop from normal views to <100 views/post:
1. Stop posting for 48h.
2. Open TikTok Studio → Account Check. If anything is flagged, address it.
3. Delete the most recent post that triggered the drop (if obvious).
4. Resume posting at half the previous cadence for 2 weeks.
5. (unverified, common wisdom): Don't try to "post your way out" of a shadow-ban. It tends to extend the suppression.

Typical recovery: 3–14 days [Manychat, Shopify, KOLHUB]. Edge cases (~1 month) when re-triggered [Proxidize].

---

## 10. Sound / music strategy

Sound is the single biggest thing Maya can recommend specifically that the user will get wrong on their own.

### Trending sound discovery

- TikTok's in-app "Sounds for You" tab in the audio picker.
- TikTok Creative Center → Trending Sounds [TikTok Insights].
- ScrapeCreators trending feed wraps this.

### The velocity rule (Maya must get this right)

A sound's lifecycle on TikTok is ~48–72 hours from first adoption to saturation [asclique.com, scribehow.com]. By the time a sound appears on a public "trending" list, it's usually 36–72 hours into saturation. Riding a sound at that point puts you against thousands of identical posts — engagement velocity drops, completion rate drops, the FYP test cohort dies.

**The sweet spot:** sounds in the first 12–24 hours of acceleration. Sounds *trending in your niche* before they're trending platform-wide. The way to find these: scroll the niche FYP, note any sound used by 3–5+ accounts you don't follow within a few days of each other but not yet on the public trending list. That's an accelerating niche sound. Use it now.

**Rule:** If a sound has been on the public trending list for >24h, Maya should mark it as "post-peak" and recommend a different one.

### Original sound vs trending vs evergreen

- **Trending sound** — best for hooking platform-wide cohorts. Use for hero launch posts where you want max distribution. Pick from the niche-velocity sweet spot above.
- **Original sound (your VO over your video)** — best for app demos where the voiceover IS the content. Daze does this most of the time. Slower distribution but compounds over time (other creators can use your sound, which signals "this is original / authoritative" to the algorithm).
- **Evergreen sound** — lo-fi loops, soft beats, recognizable but not "trending." Use when you can't find an accelerating niche sound. Lower ceiling but never penalizes.

### Commercial Music Library (CML) — required for Business Accounts

If the user has switched to a TikTok Business Account, they CAN ONLY use sounds from the Commercial Music Library [TikTok Support, ads.tiktok.com]. Using the general library on a Business Account results in muted / removed videos and can affect ad eligibility [SocialRevver, ToolSmart].

- The CML has 1M+ pre-approved tracks at no additional cost.
- BUT: CML tracks read as "stock" and consistently underperform trending sounds on organic reach. [unverified, common wisdom]
- **Maya's recommendation**: Indie founders launching from a Personal Account should *stay* on Personal Account through their first 30–60 days. The Personal Account access to the full music catalog is more valuable than the Business Account analytics they don't yet need. Switch to Business only when they need TikTok Shop, ads, or scheduling tools.

---

## 11. Decision rules for Maya (load-bearing)

These are concrete `if X then Y` rules Maya consults on every TikTok recommendation. They map to the user's `app` / `creator` state and override softer guidance above when they fire.

1. **If** `canPostTikTokManually !== true` → **do not recommend TikTok at all.** V1 has no auto-post. Surface another channel (X, LinkedIn, YouTube Shorts, Instagram Reels) instead.

2. **If** `tiktokWarmupState === "restricted"` → **block all posting recommendations.** Tell the user to resolve the TikTok Studio Account Check first. No launch posts until status returns to clear.

3. **If** `tiktokAccountAgeDays < 14` OR `tiktokWarmupState === "new_needs_warmup"` OR `tiktokWarmupState === "warming"` → **recommend the warm-up sequence (§ 6) BEFORE any launch post.** Cap posting at 1–2 niche-consumption posts per week. No commercial posts.

4. **If** the product is **un-showable** (no UI, no visual output, no before/after) AND the user **refuses slideshow Photo Mode** → **do not recommend TikTok as the primary channel.** Make it secondary or skip.

5. **If** the product has a clear **before / after** OR a **visible UI moment** under 10 sec → **recommend faceless screen-record format** as the default for the first 10 launch posts.

6. **If** the user is **camera-shy** AND the product is showable → **recommend faceless screen-record.** Don't push founder-on-camera if they're not ready; it always shows.

7. **If** the user is **willing to do slideshow** AND the niche over-indexes on text-heavy carousels (dev tools, B2B, finance, education) → **recommend slideshow Photo Mode as the primary format.**

8. **If** the user is **comfortable on camera** AND the product needs **trust or context** (agency, coaching, consulting tool) → **recommend founder talking-head format.** Otherwise default to faceless.

9. **If** the user has posted **>2 videos with identical captions** → **flag a spam risk** and recommend rewriting captions individually.

10. **If** the user is about to write the literal phrase **"link in bio"** in a caption or VO → **block / rewrite.** Use search-by-name CTA, pinned-comment URL, or "DM me '<word>'" instead.

11. **If** the niche-mining surfaces **<5 examples of a format winning in this niche** → **do not recommend that format as primary.** Pick the format with 5+ confirmed wins (the 5-video rule).

12. **If** a trending sound is **>24h on the public Trending Sounds list** → **mark it as post-peak.** Recommend a niche-velocity sound or original audio instead.

13. **If** the user has the option of **Business Account vs Personal Account** AND they're in their first 30–60 days → **recommend Personal Account.** Full music library access > Business Account analytics in early-stage launch.

14. **If** the user reports a sudden view-drop (normal → <100 views/post) → **recommend the shadow-ban recovery sequence (§ 9):** stop posting 48h, run Account Check, halve cadence for 2 weeks.

15. **If** the user wants to post >4 videos/day OR ramp >2× their current cadence in a single week → **flag spike risk** and cap the recommendation at 2–3/day for warmed accounts, 1–2/day for accounts <30 days old.

---

## 12. The "TikTok posting" deferment (why V1 doesn't auto-post)

V1 of ClawLaunch does NOT auto-post to TikTok. This is a deliberate constraint, not a bug. Maya scripts; the user posts manually.

### Why

- **TikTok's Content Posting API gates programmatic posting behind an audit process.** Unaudited API clients can only post to **private viewership** ("SELF_ONLY") and are capped at 5 posts per 24h across the entire app, with all user accounts forced to private at posting time [TikTok Developers, Zernio]. This is unusable for indie launches that need public reach.
- **The audit process** is partner-tier, takes weeks-to-months, and requires the API client to be vetted for compliance and content controls. Not realistic for V1 of a hosted multi-tenant agent.
- **Cookie-based / scraping-based posting tools** (e.g., simulating a logged-in browser session via Selenium or Playwright) are explicitly against TikTok ToS, get detected on device-fingerprint signals, and are a fast path to permanent account ban [AIVideoCut, Octobrowser]. ClawLaunch should never offer this.
- **The "Maya scripts, user posts" pattern is the correct pattern for V1.** It keeps the user manually verified, keeps the account warm-up signals honest, keeps the IP / device / SIM fingerprint clean. The friction is small because indie founders are already on TikTok daily.

### What changes in V2

- If ClawLaunch can become a vetted TikTok Content Posting API partner (audit-cleared), Maya can offer Direct Post or Upload-to-Inbox modes. Inbox mode is lower-friction (Maya prepares the post, drops it in the user's TikTok inbox, they tap once to publish). Direct Post is highest-leverage but requires more compliance scaffolding (commercial-content disclosure flags, consent flows).
- TikTok Creator Marketing API for verified businesses is a separate program (more ads-oriented) and likely not the right surface for indie-launch posting.
- Until then: scripts only. Maya should remind the user of this when they ask for auto-post features.

---

## 13. Failure stories (what NOT to do, with receipts)

Real failure modes from public sources. Maya should pattern-match user state against these and steer away.

1. **The "post immediately" failure** — Indie founders create the account, post their launch video that day, get 47 views, conclude TikTok is dead. Cause: no warm-up, algorithm flags as commercial-account-on-day-1 [Multilogin, Hypefury]. Recovery: warm-up sequence (§ 6).

2. **The "spike then ban" failure** — Founder watches a "post 10x/day to go viral" video, ramps from 0 to 15 posts in 24h, gets shadow-banned within 72h, sits in the 100-view bucket for 3 weeks [Shopify, Manychat]. Recovery: see § 9.

3. **The "identical caption" failure** — Founder writes one caption template ("New AI app — link in bio 🚀") and posts it across 8 launch videos in 4 days. Algorithm flags as spam, all 8 videos suppressed. Recovery: delete the most recent 3, rewrite remaining 5 captions individually, slow cadence for 2 weeks.

4. **The "link in bio" failure** — Founder repeats "link in bio" verbally + in caption + in pinned comment. TikTok's caption filter masks "link" and "bio" tokens [Morgan Digital, Stan.store]. Views may not drop but click-through to bio collapses because the CTA never surfaces. Recovery: use search-by-name CTA or pinned-comment URL workaround (§ 8).

5. **The "polished launch ad" failure** — Founder hires a freelance editor to produce a 60-second cinematic launch video with logo intro, transitions, and dramatic music. Posts it. Gets 200 views. Cause: the video reads as a paid ad, which has a different distribution path on TikTok (lower organic reach unless boosted) AND violates the "authenticity beats polish" heuristic for indie content [Tomas Artuso / Medium, Daze case study]. Recovery: post 5 rough, hand-shot videos in the next week. Reset the algorithm's read of the account.

6. **The "wrong format for the niche" failure** — Dev-tool founder makes founder-talking-head videos when the dev-tool niche on TikTok runs on screen-recording demos. Mismatch = drop-off in the first 2 seconds, no test-cohort expansion. Recovery: niche-mine (§ 7), switch to the niche-native format.

---

## Sources

Verified public sources used to ground this playbook. Where a claim above lacks a source citation, it is marked `(unverified, common wisdom)`.

- [Buffer — TikTok Algorithm Guide 2026](https://buffer.com/resources/tiktok-algorithm/)
- [Hootsuite — How does the TikTok algorithm work in 2025?](https://blog.hootsuite.com/tiktok-algorithm/)
- [Conbersa — How Does the TikTok Algorithm Work in 2026?](https://www.conbersa.ai/learn/tiktok-algorithm-explained)
- [go-viral.app — TikTok Algorithm 2026: Watch Time, Completion Rate & How to Go Viral](https://www.go-viral.app/blog/tiktok-algorithm-2026/)
- [Opus.pro — TikTok Hook Formulas That Drive 3-Second Holds](https://www.opus.pro/blog/tiktok-hook-formulas)
- [Opus.pro — Ideal TikTok Length & Format for Retention (Data-Backed)](https://www.opus.pro/blog/tiktok-length-format-retention-data)
- [shortimize.com — Video Length Sweet Spots: TikTok, Reels & Shorts (2025)](https://www.shortimize.com/blog/video-length-sweet-spots-tiktok-reels-shorts)
- [Manychat — TikTok Video Size Guide (Recommended Dimensions, Resolution, and More)](https://manychat.com/blog/tiktok-video-size-guide/)
- [House of Marketers — Stay Within Safe Zones for TikTok, Meta & Instagram](https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/)
- [TokPortal — TikTok Carousel Posts: Complete Guide to Photo Mode](https://www.tokportal.com/learn/tiktok-carousel-posts-complete-guide-photo-mode)
- [Socialinsider — How to Use TikTok Carousels For Successful Storytelling](https://www.socialinsider.io/blog/tiktok-carousel/)
- [growwithplutus.com — Daze Chat: How a Messenger App Built 42M+ Views Through Consistent Faceless Content](https://growwithplutus.com/blog/daze-chat-faceless-strategy)
- [Domus — How Daze works: The viral TikTok messaging app](https://www.domusweb.it/en/news/2024/10/30/how-daze-works-viral-messaging-app-social.html)
- [ecommercebridge — DAZE: New Gen Z Messaging App Goes Viral With 48M Views Before Launch](https://www.ecommercebridge.com/daze-new-gen-z-messaging-app-goes-viral-with-48m-views-before-launch/)
- [@daze.chat live launch video on TikTok](https://www.tiktok.com/@daze.chat/video/7433980052905430318)
- [@skyirezumi (Pushscroll) launch post](https://www.tiktok.com/@skyirezumi/video/7513681195717217558)
- [@skyirezumi (Pushscroll) day-one update](https://www.tiktok.com/@skyirezumi/video/7514096929836502294)
- [Medium / Classy Endeavors — They Made a Fake App Demo, Got 80K Views, Then Built a $30K/Month Business](https://blog.classyendeavors.com/they-made-a-fake-app-demo-got-80k-views-then-built-a-30k-month-business-eb615e3e2f80)
- [Superwall — How Stronger Built a $600K App Using "Viral on Demand" TikTok Strategy](https://superwall.com/blog/how-stronger-built-a-usd600k-app-using-viral-on-demand-tiktok-strategy/)
- [@strongermobile on TikTok](https://www.tiktok.com/@strongermobile)
- [Tomas Artuso / Medium — Make Your App Go Viral for $1.8K](https://medium.com/@tomasartusoo/make-your-app-go-viral-for-1-8k-2a9de40913d1)
- [TokPortal — TikTok Marketing for SaaS Companies: The Complete B2B Playbook](https://www.tokportal.com/verticals/tiktok-marketing-saas-companies)
- [ScreensDesign — Cal AI Calorie Tracker UI Breakdown](https://screensdesign.com/showcase/cal-ai-calorie-tracker)
- [Hypefury — What is a TikTok Shadow Ban? What it is and How to Prevent it](https://hypefury.com/tiktok/what-is-a-tiktok-shadow-ban/)
- [Multilogin — How to Identify and Remove a TikTok Shadow Ban in 2026](https://multilogin.com/blog/tiktok-shadow-ban/)
- [Shopify — TikTok Shadow Ban in 2026: 5 Ways to Fix It](https://www.shopify.com/blog/tiktok-shadow-ban)
- [KOLHUB — TikTok Shadow Ban: Everything You Need to Know in 2025](https://kolhub.com/my/tiktok-shadow-ban-everything-you-need-to-know)
- [Manychat — How Long Does TikTok Shadowban Last?](https://manychat.com/blog/tiktok-shadowban/)
- [Proxidize — How to Detect and Fix a TikTok Shadow Ban](https://proxidize.com/blog/tiktok-shadow-ban/)
- [Octobrowser — TikTok Shadowbans: How to Get Out](https://blog.octobrowser.net/tiktok-shadowbans-how-to-get-out)
- [AIVideoCut — TikTok Shadow Ban in 2026: Myth, Reality, or Algorithmic](https://www.aivideocut.com/blog/tiktok-shadow-ban-algorithm)
- [Sendshort — TikTok Shadow Ban: What, Why & How To Fix](https://sendshort.ai/guides/tiktok-shadowban/)
- [TikTok Community Guidelines](https://www.tiktok.com/community-guidelines)
- [VVITCH Digital — The Unspoken Rules of Marketing on TikTok / How to Avoid TikTok Censorship](https://www.vvitchdigital.com/blog/tiktok-rules)
- [Morgan Digital — Why can't you say "link in bio" on TikTok?](https://morgandigital.co.uk/why-cant-you-say-link-in-bio-on-tiktok/)
- [Stan.store — TikTok Link in Bio: Requirements & How to Add (2026)](https://stan.store/blog/tiktok-link-bio-requirements-2026-guide/)
- [UniLink — TikTok Link in Bio Requirements (2026 Update)](https://unil.ink/blog/tiktok-link-in-bio-requirements-2026)
- [feedguardians.com — How to Pin a Comment on TikTok: Quick 2026 Guide](https://feedguardians.com/guides/how-to-pin-comment-on-tiktok)
- [Colorado State Social — How to Add a Link to a TikTok Post](https://social.colostate.edu/best-practices/how-to-add-a-link-to-a-tiktok-post-and-why-its-not-like-other-platforms/)
- [TikTok Newsroom — Reply to comments with video](https://newsroom.tiktok.com/product-tutorial-reply-to-comments-with-video?lang=en)
- [asclique.com — How TikTok Audio Trends Evolve and Why Timing Is Everything](https://www.asclique.com/blog/how-tiktok-audio-trends-evolve-and-why-timing-is-everything/)
- [scribehow.com — TikTok Trending Audio Research Tools Aren't Finding What You Think](https://scribehow.com/page/TikTok_Trending_Audio_Research_Tools_Arent_Finding_What_You_Think_They_Are__25ukgp1XTda73H3GMU2dFg)
- [TikTok Support — Commercial use of music on TikTok](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok)
- [TikTok — Commercial Music Library User Terms](https://www.tiktok.com/legal/page/global/commercial-music-library-user-terms/en)
- [SocialRevver — TikTok Commercial Music Library: How To Use It Legally](https://www.socialrevver.com/blog/tiktok-commercial-music-library)
- [ToolSmart — A Complete Guide to TikTok Commercial Music Library Use](https://www.toolsmart.ai/blog/a-complete-guide-to-tiktok-commercial-music-library-use/)
- [TikTok Developers — Content Posting API](https://developers.tiktok.com/products/content-posting-api/)
- [TikTok Developers — Content Posting API: Get Started](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [Zernio — TikTok Content Posting API: The Complete Developer Guide](https://zernio.com/blog/tiktok-developer-api)
- [ScrapeCreators — TikTok API](https://scrapecreators.com/tiktok-api)
- [docs.scrapecreators.com — TikTok Get popular hashtags API](https://docs.scrapecreators.com/v1/tiktok/hashtags/popular/)
- [docs.scrapecreators.com — TikTok Profile Videos API](https://docs.scrapecreators.com/v3/tiktok/profile/videos/)
- [Sprout Social — TikTok Hashtags: How to Use Them to Gain More Views](https://sproutsocial.com/insights/tiktok-hashtags/)
- [Metricool — TikTok Hashtags Guide](https://metricool.com/tiktok-hashtags/)
- [IndieHackers — Meet the indie hackers killing it on TikTok](https://www.indiehackers.com/post/creators/meet-the-indie-hackers-killing-it-on-tiktok-3znZ4MnXFrhlr5CCVuio)
- [Suraj Kadam — Marc Lou's SaaS Marketing Tactics: A Data-Driven Analysis](https://imsurajkadam.com/marc-lous-saas-marketing-tactics/)
- [Fourthwall — TikTok Success Stories: 10 Inspiring Creators and Brands](https://fourthwall.com/blog/tiktok-success-stories-10-inspiring-creators-and-brands)
- [SocialMediaToday — TikTok Adds More Direct Publishing Options to Its API](https://www.socialmediatoday.com/news/tiktok-adds-more-direct-publishing-options-api-facilitate-third-party-posting/696193/)
