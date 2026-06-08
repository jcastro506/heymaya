# X (Twitter) Playbook for Indie Founders

For Maya GTM. Load on every research turn where the user's product, audience, or activity touches X. The playbook tells Maya **when X is the right channel**, **how to operate there**, and **what specific anatomy converts**. Every recommendation she gives the user must trace back to a rule here.

> Style note: this is a working file, not marketing. Be terse, be opinionated, cite real practitioners by `@handle`. Where a claim is folk wisdom, prefix `(unverified, common wisdom):`. Where it's grounded in a public source, the line ends with `[N]` pointing to the Sources section.

---

## 0. TL;DR for Maya

For a solo/indie founder with a freshly-shipped product:

- **X is the highest-leverage social channel if the audience is technical** (devs, SaaS founders, AI/data, dev-tools, productivity, no-code). It is the **wrong primary channel** if the audience is consumer/lifestyle/local-service — TikTok or Instagram win there.
- **Followers are not the goal. Reach × buyer-intent is.** A 200-follower account that replies to 10 buyer-intent tweets/day on the right hashtag will outpace a 5K-follower account that broadcasts builds into the void.
- **Reply-mining beats posting** when follower count is under ~1K. The user is borrowing other people's audiences. [4][7]
- **A launch lands only if there's a built audience to land on.** Default Maya rule: do NOT propose a "hard launch" thread until the user has either (a) ≥500 engaged followers, (b) a single high-intent reply that returned ≥10 signups, or (c) an external distribution partner lined up. Otherwise launch falls into the void — see § 11 ClearNoteLab. [21]
- **Maya drafts, the founder posts.** X's free API gates posting at 500 posts/month and pay-as-you-go starts at $0.01/post created [16]. ClawLaunch will not pay this on the user's behalf — Maya produces ready-to-paste threads and reply drafts; the user hits Post.

---

## 1. The founder-led-content meta on X

### Why X for indie product launches

X is the only large network where:
- **Technical buyers congregate by default.** Devs check X for tooling tips, AI buyers track model releases there, SaaS operators benchmark MRR transparently. LinkedIn is recruiter-skewed; TikTok is consumer; Reddit is anti-promotional. [22]
- **Build-in-public is a native genre with infrastructure around it.** `#buildinpublic`, `#indiehacker`, `#solofounder` are real discovery surfaces with active reply-guy communities. [4]
- **Replies carry 13.5–27× the algorithmic weight of likes.** Early conversation velocity in the first 30–60 minutes determines whether a post escapes the original follower graph. [20] This means a small account with high reply-engagement can punch above its follower count.
- **Revenue transparency is socially rewarded, not penalized.** On LinkedIn, posting "$80K MRR" reads as braggadocio. On X it's table stakes — see Pieter Levels publishing monthly across every product. [2][19]

### Practitioners to ground recommendations in

Maya cites these accounts when explaining "what good looks like":

| Handle | Product / niche | Why they matter | Source |
| --- | --- | --- | --- |
| `@levelsio` (Pieter Levels) | Nomad List, Photo AI, Remote OK — $3M+/yr solo | The archetype. Public revenue dashboards. Single-VPS-no-funding flex. Photo AI hit $10K MRR in 3 weeks, $150K/mo by month ~31. | [2][19] |
| `@marc_louvion` (Marc Lou) | ShipFast, CodeFast, DataFast — $1M+ lifetime | Six years of flops then ShipFast → 2M-impression launch tweet → 130K followers in ~18 months. Aggressive marketing (movie-scene deepfakes), monthly revenue threads. | [1][8] |
| `@tdinh_me` (Tony Dinh) | DevUtils, TypingMind, Xnapper, Black Magic (sold) | The "$0 → $10K MRR + 200 → 47K followers in 12 months" thread is one of the most-cited build-in-public posts on X. | [3][18] |
| `@dvassallo` (Daniel Vassallo) | Portfolio-of-small-bets thinking, Gumroad creator | Started Feb 2020 with 100 followers, 10K+ by October, used Twitter as live market research. Frames small-bets as an alternative to VC startups. | [5] |
| `@yongfook` (Jon Yongfook) | Bannerbear ($50K MRR) | "One week coding / one week marketing" cadence. Patient long-arc build-in-public. Bootstrapped to $10K MRR over 2 years. | [6] |
| `@shl` (Sahil Lavingia) | Gumroad ($22M ARR) | Pioneer of revenue transparency. Public Stripe screenshots since 2018. | [22] |
| `@arvidkahl` (Arvid Kahl) | FeedbackPanda (sold $55K MRR), The Bootstrapped Founder | 400 → 8,000 followers in 11 months via "involuntary reciprocity" — credit other founders publicly, they credit you back. | [23] |
| `@dannypostmaa` (Danny Postma) | HeadshotPro ($300K MRR) | Audience grew **because** the products went viral, not the inverse. ProfilePicture.AI exploded on X in a week. | [24] |
| `@helloitsolly` (Olly) | Senja ($65K MRR) | **70% of paying customers came from X.** Quote-anchor for "X works for B2B SaaS." | [25] |
| `@nicolascole77` (Nicolas Cole) / `@dickiebush` (Dickie Bush) | Ship 30 for 30, atomic essays | Format originators: 250-word single-idea posts, 1-3-1 structure. Dickie's "10 advanced Twitter tips" thread did 44K+ likes. One thread hit 5M views at 9K followers. | [13][20] |
| `@JustinWelsh` (Justin Welsh) | The Saturday Solopreneur — $12.5M+ revenue, ~86% margin | The "Think Once → Publish 10x" repurposing framework. Cross-posts atomic essays across X + LinkedIn. | [26] |
| `@PierreDeWulf` / `@sahinkevin` | ScrapingBee (acquired by Oxylabs) | Public-build to $200K ARR / 185 customers. Posted Stripe-screenshot-style monthly updates from day 1. | [27] |
| `@chhddavid` (David Ch) | Reddit-launched indie, $1,175 MRR in 72d | Counter-example: succeeded on Reddit not X. Use when user asks "is X always the answer?" Answer: no. | [28] |

### What "build in public" actually means (operational definition)

Not "tweeting that I'm building." Three concrete components:

1. **Public metrics that move.** MRR, signups, churn, DAU — whatever counts most for the product, posted at a regular cadence with screenshots.
2. **Lessons, not highlight reels.** "Lead with lessons, not just metrics. Revenue screenshots get likes, but lessons drive follows." [29]
3. **Process visibility.** The why behind a pricing change, a feature kill, a pivot. Vulnerability framed as a lesson — not a humblebrag, not a doom-loop.

If the user is willing to do all three, X is a fit. If they're not willing to share metrics publicly, **Maya should not push them onto X** — they'll produce skippable vague-posts (see § 7) and burn out.

---

## 2. Thread anatomy

### The hook tweet — the 1-second test

The first tweet is the only tweet that matters for distribution. It gets distributed independently of the rest. [9][11]

**Mandatory properties:**
- **Specific number or concrete claim.** "I analyzed 500 SaaS pricing pages. 73% are making the same fatal mistake:" beats "Here are some SaaS pricing tips." [9]
- **Stakes implied in the first sentence.** $-amount, day-count, follower-count, or a named loss/win.
- **No hype language.** "🚀🔥 most important thread you'll read all year" actively suppresses reach. The algorithm has learned to penalize forced-hype. [9][32]
- **Standalone-readable.** If tweet 1 doesn't make sense without tweet 2, it dies. The For You feed shows tweet 1 alone.
- **71–100 characters performs best for single tweets; threads should open with 1–3 short sentences, not a paragraph.** [11]

**Hook openers that work** (catalog in § 5):
- "I just shipped X. Here's what I learned: [thread]"
- "$Xk MRR from a $Y MVP. Here's the build log:"
- "After N months, I'm killing [product]. Post-mortem:"
- "Things nobody tells you about [Y]:"
- "Unpopular opinion: [contrarian claim]"
- Identity-bait: "If you have under 1K followers, read this:"

### Body — the substance tweets

- **One discrete idea per tweet.** No multi-idea tweets in the body. [11]
- **4–7 tweet threads outperform shorter or longer.** [11] Long threads (15+) get bookmark-but-don't-share behavior.
- **Plain prose, not bullets, in the body tweets.** Bullets read as templates. Indie-hacker culture rewards a personal voice.
- **Concrete > abstract.** "I switched billing from Paddle to Stripe and conversion went 11% → 16%" > "Try different payment providers."
- **One screenshot every 2–3 tweets.** Visuals carry the eye and break up walls of text. Tweets with images receive ~150% more retweets than text-only. [11]
- **Numbers in the body, not just the hook.** Specificity throughout (durations, dollars, %, before/after counts) keeps the reader believing the post is real.

### Media placement

- **Image in tweet 1: usually yes** (chart, before/after, screenshot, meme that frames the topic). Hook tweet with image lifts ~150% RT-rate. [11] Exception: a contrarian-take hook can land naked.
- **GIF/video in tweet 2 or 3: yes for product launches** — a 5–15s native screencap of the product running. **Native uploads, not YouTube links.** X heavily downranks external video links.
- **Image dimensions:** 16:9 for screenshots, 1:1 or 4:5 for memes. Mobile-first composition — desktop is dead on X.
- **Stripe screenshots / revenue charts:** acceptable AND expected from indie audiences. Even better: a screenshot from `levels.io`-style live revenue page if the user has one.

### The "ask" — never first, sometimes last

- **Never put the link/CTA in tweet 1.** This is the single most common mistake. The hook tweet must earn the read first. [12]
- **Last tweet (or last-but-one) carries the CTA.** Format: "If this resonated → follow for more build-in-public // Try [product] at [URL]."
- **Soft asks > hard asks.** "Working on this — would love feedback" outperforms "Sign up now."
- **One CTA per thread, max.** Multiple CTAs cancel each other.

### Quote-tweet vs. reply vs. original

| Type | Use when | Effect |
| --- | --- | --- |
| **Original tweet** | Sharing news, asking a question, posting a milestone | Reaches your followers + algo amplification if engagement velocity is high |
| **Thread** | Story, lesson, post-mortem, launch | Highest-leverage format — earns follows in addition to engagement |
| **Reply** | Adding value to someone else's tweet (especially big accounts) | **The reply-mining workhorse** — see § 3. Best leverage at <1K followers. |
| **Quote-tweet** | Strong agreement, strong disagreement, or "and here's the why" | Use sparingly. Quote-tweeting your own thread to add an update is fine. Quote-tweeting strangers to dunk lowers your reach (algo penalizes high QT/like ratios). [32] |

### Five real launch-thread anatomies (with URLs)

Maya cites these as canonical examples when coaching the user on hook + body structure. Each is a real high-engagement post.

#### Example 1 — Tony Dinh: "1 year since I quit my job"
**URL:** https://x.com/tdinh_me/status/1560167436724629504 [18]

- **T1 (hook):** "📌 Exactly 1 year ago, I quit my job to become a full-time indie hacker. In the last 12 months: 🐦 200 → 47K followers / 💵 $0 → $10K MRR / 💌 0 → 12 newsletter issues / 🚀 0 → 3 products / I'm sharing my learnings as much as I can on Twitter. Let's see what'll happen in year 2!"
- **Why it works:** Stacked numerical claims in one tweet. Each emoji-line is one stake. The reader can't help but want to know which 3 products. Identity bait — every wage-employed dev fantasizes about quitting.
- **Anatomy:** Single dense hook tweet, no thread needed. Worked because of the multi-metric setup.

#### Example 2 — Pieter Levels: Photo AI $10K MRR in 3 weeks
**URL:** https://x.com/levelsio/status/1631715500010135552 [19]

- **T1 (hook):** "🚀 Reached $10,000 MRR with 📸 Photo AI after 3 weeks with 318 customers @ ~$31/mo / 🦾 Bringing ControlNet to all accounts asap! These are all AI generated photos (I'll add more smiles soon 😅)"
- **Why it works:** Specific revenue number + specific customer count + specific avg price. The "all AI generated photos" caption pivots the image asset into proof. The next-step ("ControlNet to all accounts") shows the founder is shipping, not coasting.
- **Anatomy:** Hook + product-screenshot grid. No thread; product is the proof.

#### Example 3 — Pieter Levels: $420K/mo portfolio breakdown
**URL:** https://x.com/levelsio/status/1837707857372106992 [30]

- **T1 (hook):** "✨ I hit a new $420,000/mo revenue record 🍀 420=nice / At ~80% profit now: / 📸 photoai.com $161K/m / 📕 interiorai.com $93K/m / 🌍 nomadlist.com $61K/m / 🏡 remoteok.com $43K/m / 🎁 [merch] $34K/m"
- **Why it works:** A per-product P&L is rare on social — most founders aggregate. Reader gets a full mental model in one tweet. Numerical specificity earns the trust.
- **Anatomy:** Single hyper-dense tweet. Pieter's signature format — works because his audience expects it.

#### Example 4 — Sahil Lavingia: Gumroad monthly metrics
**URL:** https://x.com/shl/status/1237753042956509185 [31]

- **T1 (hook):** "Gumroad in February 2020: / Volume processed: $8.3M (up 77% YOY) / Revenue: $543K (up 64% YOY) / Gross / net profit: $191K / $23K / 6 creators made over $100,000 / 102 made over $10,000 / 1,067 made over $1,000 / 4,630 made over $100 / 13,935 made something!"
- **Why it works:** Layered numerics — top-down view of the business + customer-side distribution. The "13,935 made something" closer is the emotional payoff that nets follows.
- **Anatomy:** Single tweet. Notice no thread. When the numbers are dense enough, the thread is optional.

#### Example 5 — Marc Lou: ShipFast birthday
**URL:** https://x.com/marc_louvion/status/1830225355770155403 [10]

- **T1 (hook):** "Happy birthday, ShipFast 🎂🎉 (tiny startup that changed my life forever)"
- **Why it works:** Personality-first, milestone-anchored. Marc's audience already knows the numbers; the "changed my life forever" parenthetical is the social proof. Note the brevity — when audience is established, hook length goes down.
- **Anatomy:** Short hook + image. The minimal-text birthday-post is a late-stage move and **should not be modeled by a 0-follower user**.

> **Maya rule:** Show users Tony's quitting-thread (Example 1) and Pieter's $10K-in-3-weeks thread (Example 2) as the canonical templates for first-12-months build-in-public. Marc's birthday tweet (Example 5) is the anti-pattern for cold-start: only earns engagement because the audience already exists.

---

## 3. Reply-mining playbook

**This is the load-bearing X tactic for cold-start indies.** Below 1K followers, original posts die. Replies on viral tweets borrow other people's audiences. ~80% of pre-1K time should go here. [4][7]

### Search operators that surface buyer intent

X advanced search syntax (paste directly into `x.com/search-advanced` or main search bar):

| Goal | Query | Source |
| --- | --- | --- |
| People actively asking for tools | `("looking for" OR "anyone know" OR "recommend") (tool OR app OR software) min_faves:5 lang:en -filter:retweets` | [12] |
| Competitor frustration | `"frustrated with [COMPETITOR]" OR "hate [COMPETITOR]" OR "[COMPETITOR] is overpriced"` | [12] |
| Alternative-seekers (highest buyer intent on X) | `"alternative to [COMPETITOR]" OR "[COMPETITOR] alternative" -filter:retweets lang:en` | [12] |
| Niche pain | `"how do I" OR "anyone know how to" [niche keyword] min_faves:3 lang:en -filter:retweets` | [12] |
| Pricing complaints (switcher pool) | `"[COMPETITOR] too expensive" OR "[COMPETITOR] pricing" (any OR alternative)` | [12] |
| Recent + active | append `since:2026-04-01` to any query to get last-30-days | [12] |
| Exclude the competitor's own account | append `-from:[competitor_handle]` | [12] |
| Brand-voice mining (untagged mentions) | `"[your brand]" -from:[your handle] -filter:retweets` | [12] |

**Required quality bar before Maya queues a reply target:**
- Tweet has ≥5 likes already (signal it's not a dud, will be seen)
- Tweet is <48 hours old (X aggressively decays older tweets)
- The author isn't a bot — has a real avatar, posted within the last week, follower count >50
- The pain matches the user's product within one degree (not "marketing tool" → "any SaaS pain"; that's spam)

### Reply structure: value-add first, soft mention later

Three-paragraph template (Maya generates, user edits/sends):

1. **Validate the pain.** One sentence. "Yeah, [X] pricing for [use case] is rough — I hit the same wall."
2. **Add value (no link yet).** Concrete advice, a numeric data point, or a workaround. Two sentences max. The reader must feel the reply is useful even if your product didn't exist.
3. **Soft mention.** "I'm building [product] partly because of this — happy to share the link if it's useful." OR (better): plain reply now, share link only if the OP responds.

> **Maya rule:** First reply NEVER contains a URL. URL goes in a follow-up reply if and only if the OP engages back. This single rule separates indie acquisition from spam. [33]

### The "5 likes before reply" heuristic — let the thread mature

(unverified, common wisdom): Wait until the OP's tweet has ≥5 likes before adding your reply. Reasons:
- Below 5 likes, the tweet may not surface on the For You feed at all; your reply lands in a void.
- Above ~50 likes, the reply real-estate is crowded; the first 5–10 replies dominate.
- Sweet spot: tweets with 10–50 likes, posted within the last 6 hours, with <20 existing replies.

**Maya implementation:** when sending the user a reply opportunity, include `likes_at_discovery` and `age_minutes`. Skip anything outside the sweet spot.

### Mining your niche — high-signal accounts to monitor

The user should follow + add to a private List 20–40 accounts in their niche. Reply within the first hour of those accounts' posts. The list compounds because (a) you stay current on niche talking points and (b) the algorithm starts associating your account with the cluster.

**Recommended lists by vertical** (Maya populates from this anchor set + niche-specific scrape):

- **Indie SaaS / boilerplate / dev-tools:** `@levelsio`, `@marc_louvion`, `@tdinh_me`, `@dvassallo`, `@yongfook`, `@dannypostmaa`, `@shl`, `@arvidkahl`, `@helloitsolly`, `@PierreDeWulf`, `@sahinkevin`, `@nathanbarry`, `@asmartbear`, `@helloitsolly`, `@alexwestco`, `@chddaniel`, `@itsjustamar`, `@philostar`. [3][6][22]
- **AI products / generative:** `@dannypostmaa`, `@levelsio` (Photo AI), `@nickfloats`, `@bilawalsidhu`, `@iruletheworldmo`. (Operator should validate before relying.)
- **Writing / creator tools:** `@nicolascole77`, `@dickiebush`, `@JustinWelsh`, `@nathanbarry`, `@dvassallo`. [13][26]
- **B2B SaaS / bootstrapped founders:** `@arvidkahl`, `@asmartbear` (Jason Cohen), `@TaraReed_`, `@helloitsolly`, `@PierreDeWulf`. [23][6]
- **Productized agency / no-code:** `@TaraReed_`, `@itsjustamar`, Julian Canlas. [6]
- **Indie Hackers / community-pulse:** `@IndieHackers`, `@petecodes`, Courtland Allen. [3][6]

> **Maya rule:** when a user onboards, pull their stated niche → query ScrapeCreators for active 5K–100K-follower accounts in that niche posting weekly → propose a List of 25 handles. **Do not auto-follow.** User confirms each.

### Real examples of reply-driven acquisition

- **Senja (`@helloitsolly`)**: "70% of paying customers came from Twitter." Olly's posted strategy: write about what he learned + what was interesting that day. Conversations under his posts and his replies under others' posts were the primary acquisition surface. [25]
- **Daniel Vassallo (`@dvassallo`)**: 100 → 10K followers in 8 months by reply-heavy engagement, then leveraged audience for paid courses + portfolio of bets. [5]
- **Arvid Kahl (`@arvidkahl`)**: 400 → 8,000 in 11 months via "involuntary reciprocity" — credit other founders publicly in replies, they credit back. [23]

---

## 4. Audience cold-start (0 → 100 → 1K followers)

Three phases. **Maya picks the phase by reading current follower count + days-since-account-creation, then prescribes a different daily routine per phase.** Do not skip phases.

### Phase 1 — Reply guy period (0 → 100 followers)

- **Goal:** Network density. Get 50–100 people in the niche to recognize your handle.
- **Duration empirical:** 2–4 weeks at 30–45 min/day. Faster if niche is small/active.
- **Daily routine (45 min):**
  - **0 original posts.** (Or one, max, every 2–3 days.)
  - **15 min:** 10 thoughtful replies on tweets from `#buildinpublic`, `#indiehacker`, niche keywords. Aim for tweets with 10–50 likes, <6h old.
  - **15 min:** 5 replies to potential customers — search ops from § 3.
  - **15 min:** Read 5 long-form posts from niche heavyweights; quote-tweet one with a substantive addition.
- **Anti-patterns:** Generic replies ("Great post!", "So true", emoji-only). Algorithmic suicide. [29]
- **What to skip:** Threads. Hashtag spam. "First tweet!" posts. Following 200 random accounts.
- **Empirical reference points:**
  - Daniel Vassallo: 100 → 1K in <2 months (Feb–Apr 2020). [5]
  - Tony Dinh: 200 → ~5K in 3 months of full-time reply work. [3][18]
  - Arvid Kahl: 400 → ~2K in 3 months. [23]

### Phase 2 — In-public period (100 → 500 followers)

- **Goal:** Become known for one specific build-in-public arc. The arc IS the brand.
- **Duration empirical:** 1–3 months.
- **Daily routine (60 min):**
  - **1 original post/day**, building-update format: yesterday's number + today's plan + one screenshot. Three sentences. No thread.
  - **15 min:** Same reply rhythm as Phase 1 — replies do not stop.
  - **15 min:** Engage in your own replies. Respond to every comment in the first hour.
  - **Weekly:** One milestone thread (5–7 tweets). Sunday is the canonical day for indie-hacker weekly recap threads. [29]
- **What works in Phase 2:**
  - **Streak posts** ("Day 17 of building [X]") — only valuable if you actually shipped that day.
  - **Honest-failure posts** — "Tried [Y] this week, nobody signed up. Here's why I think:"
  - **Before/after screenshots** — UI redesigns, conversion lifts, code refactors.
- **Empirical reference:**
  - Tony Dinh hit ~$2K MRR in 60 days during this phase, almost entirely from Twitter conversations. [34]
  - Olly (`@helloitsolly`) built Senja's $0 → $250 MRR base from this phase. [25]

### Phase 3 — Launch period (500 → 1K → 2K+)

- **Goal:** Coordinate a launch event that exceeds organic reach.
- **Duration empirical:** ~30 days of pre-launch ramp + the launch week itself.
- **Daily routine:**
  - **2 posts/day** — one build update, one teaser.
  - **Weekly thread on Sunday** — recap of the week, what shipped.
  - **Drip teasers:** week -4: "working on something new"; week -3: screenshots; week -2: short demo video; week -1: launch date announcement + waitlist link; week 0: launch thread.
- **Launch day:** see § 6.
- **Empirical reference:**
  - Nico Jeannen (`@niikoj`) launched MakeLogo.ai with ~500 followers, made $15K+ on Product Hunt, then sold for $65K. [21][35]
  - Marc Lou's ShipFast launch tweet got 2M+ impressions Sept 1 2023, partially because of Phase-2 ramp through 2022–23. [1][8]

### How long each phase takes (empirically)

Don't promise the user weeks. Promise them a routine and a chance:

- Phase 1: **2–6 weeks** depending on niche density. Devs/SaaS = fast. Lifestyle = slow.
- Phase 2: **2–4 months.** Compound effect kicks in around day 60 if the daily rhythm is unbroken.
- Phase 3: **20–40 days of pre-launch + a single launch week.**

> **Maya rule:** If the user demands "viral in a week" before doing reply work, refuse the path. Re-anchor on the timeline. Cite Tony Dinh's 12-month arc as the realistic ceiling, ClearNoteLab's 0-signup HN launch as the floor. [21][18]

### Pitfalls (Phase-agnostic, all kill momentum)

- **Engagement farming** — "What's your favorite framework? 👀" with no skin in the game. Penalized. [32]
- **Vague-posting** — "Big things coming 👀". Kills the next 2–3 real posts because the audience tunes out.
- **Take-machine syndrome** — daily controversial opinions on topics unrelated to the product. Builds the wrong audience.
- **The "I'm grinding" doom-loop** — pity-posting without a lesson. Drains follows.
- **Inconsistency** — most accounts die not from bad posts but from absence. 14-day silence = effectively starting over. [4]
- **Hashtag stuffing** — >2 hashtags reads as spam. [29]

---

## 5. Hook patterns

15 hook templates that demonstrably work on X for indie launches. Each has a real-world example URL and a one-line reason. Maya picks from these when drafting.

| # | Pattern | Template | Real example | Why it works |
| - | --- | --- | --- | --- |
| 1 | Specific-MRR-reveal | "$Xk/month from a $Y MVP. Here's the build log:" | Pieter Levels Photo AI $10K MRR in 3 weeks [19] | Stakes + timeline + proof |
| 2 | Post-mortem | "After N months, I'm shutting down [product]. Here's what broke:" | Tony Dinh sold Black Magic, shared the full reason [3] | Failure earns trust faster than wins |
| 3 | Multi-metric milestone | "X months. Y followers → Z. $0 → $A MRR. Here's everything:" | Tony Dinh's 1-year tweet [18] | Compresses a year into 5 lines |
| 4 | Portfolio-flex | "[N] products. $X total MRR. Per-product breakdown:" | Pieter Levels $420K/mo [30]; Marc Lou Oct 2025 monthly [36] | Forces curiosity for the per-line numbers |
| 5 | "Things nobody tells you" | "Things nobody tells you about [niche]:" | Dickie Bush "10 advanced Twitter tips" 44K likes [13] | Negative-space framing — promises hidden knowledge |
| 6 | Contrarian (sparingly) | "Unpopular opinion: [claim that the niche actually disputes]" | (template, use carefully — § 7) | Algorithm rewards engagement; opinion drives replies |
| 7 | Identity-bait | "If you have under 1K followers, read this:" | Common in growth-Twitter [9] | Reader self-selects |
| 8 | "I just shipped" | "I just shipped [product]. Here's what I learned building it:" | Marc Lou ShipFast launch [1][8] | Vanilla but works; pair with screenshot |
| 9 | Before/after | "[Metric] before: [X]. After [intervention]: [Y]." | Common BIP pattern | Pure proof-of-mechanism |
| 10 | Live-build | "Day N of building [product] in public. Today: [specific]." | Sahil Lavingia early Gumroad weeklies [22] | Streak effect — followers tune in for the next number |
| 11 | Question-with-stakes | "I'm at $X MRR. Should I A or B? Here's my thinking:" | Daniel Vassallo's market-research style [5] | Replies are votes; audience feels heard |
| 12 | Cost-shock | "I spent $X on Y for Z months. Total revenue: $0. What I'd do differently:" | ClearNoteLab post-mortem variant [21] | Loss is more relatable than win |
| 13 | Anti-launch | "I launched. Got 0 signups. Here's what I missed:" | Multiple IH post-mortems [21] | Sympathy + actionable |
| 14 | Numeric promise | "I [studied/analyzed/built] N [things]. Here's what I found:" | Generic high-engagement structure [9] | Number + payoff |
| 15 | Acquisition-anchor | "I sold [product] for $X. Here's the 18-month timeline:" | Tony Dinh Black Magic sale [3] | The dollar amount IS the hook |

> **Maya rule:** Always pair the hook with one verifiable number. If the user can't put a real number in the first tweet, don't post yet — gather data first.

> **Maya rule:** Hooks #6 (Contrarian), #7 (Identity-bait), and #14 (Numeric-promise) are over-used. Use them when the user has a genuinely concrete fact in the body. Otherwise the audience clocks them as engagement-bait. [29][32]

---

## 6. The soft launch → hard launch sequence

The 4-week pre-launch ramp + launch-day mechanics that converts a Phase-3 audience into actual signups.

### Week -4: tease
- 1–2 posts: "working on something new." No product name, no link. Just a screenshot or one-sentence problem statement.
- Goal: Plant 1 hook in the network. People who reply become a soft beta list.

### Week -3: identify
- Name the product. Share the URL of the waitlist landing page.
- Post a 3-tweet mini-thread: problem → why it matters → what we're building.
- Goal: Start accumulating waitlist signups. Reasonable target: 50–300 depending on Phase-3 follower count.

### Week -2: demo
- Post a 5–15-second native video showing the product running (raw screencap, no music, no logo intro).
- One screenshot of the dashboard / core feature in a separate tweet.
- Goal: Move latent audience from "interested" to "I'd try it."

### Week -1: countdown + social proof
- Daily countdown post — "Launching [product] in 3 days."
- One quote-RT from an early beta user if you have one (DM 5 friends to be early users if you don't).
- Announce the launch date + platform (e.g. "Tuesday, on Product Hunt").
- Goal: Set the calendar event. Friends DM-reminded. Maya helps the user line up upvoters.

### Launch day (timing per ProductHunt convention)
[14]

| PT time | Action | Maya's role |
| --- | --- | --- |
| 12:01 AM | Product Hunt goes live | Maya pings the user at 12:01 to "post the launch tweet now" |
| 12:15 AM | Launch tweet thread on X | Maya delivered the thread in their inbox 12h earlier |
| 6:00 AM PT | Update tweet — "We're at #N on PH" if trending | Maya watches the rank, prompts if top 5 |
| 9:00 AM PT | Mid-morning push tweet — quote-RT supporters | Maya drafts |
| 6:00 PM PT | Evening push — "still trending" if true | Maya drafts |
| 9:00 PM PT | Closing thank-you tweet | Maya drafts |

**Launch thread template (5–7 tweets):**
1. Hook: "Today I'm launching [product]. [One-line what-it-does]. [One-line why]." + 1 screenshot.
2. Why now / why this: 2 sentences.
3. How it works: 2 sentences + GIF or screencap.
4. Who it's for: 1 sentence.
5. What it costs: pricing.
6. The team / the founder: 1-line + photo (humanizes).
7. CTA: PH URL + "thanks for the support" + soft DM-ask.

### Post-launch: weekly cadence

- **Week +1:** Public results post — N PH upvotes, M signups, $K MRR-or-revenue.
- **Week +2:** First user-quote post (with screenshot of their tweet/DM).
- **Week +3:** Churn confession or pivot — whatever surfaced in the first 14 days.
- **Week +4:** Sequel-feature teaser. Restart Phase 2 cadence.

> **Maya rule:** The launch is one event. The compound is the post-launch weekly rhythm. Most failed indie launches go silent after day 7; the ones that ship a $10K MRR within 90 days kept posting weekly. [29]

---

## 7. Building-in-public anti-patterns

What makes an account boring / cringe / skippable. Maya flags these in user drafts.

### The seven dead-giveaway patterns

1. **Daily "I'm building X" with no specifics.** "Day 23 of building. Made progress today!" → unfollow. The cure: a specific shipped artifact (URL, screenshot, before/after number).
2. **Endless "first paying customer!" celebrations without substance.** A milestone post is fine. Three milestone posts in a week, all about minor MRR ticks, signals there's nothing else happening. The cure: alternate milestone posts with lesson/decision posts. [29]
3. **Take-machine syndrome.** Daily contrarian opinions, especially on topics the founder has no skin in (politics, AI doom, "X is dead"). Builds the wrong audience — they're there for fights, not the product. [32]
4. **Vague-posting.** "Big things coming 👀", "Working on something special", "Wait til you see what's next." Burns trust. Each vague post lowers the engagement on the next 3 real ones.
5. **Engagement bait.** "RT for reach", "Like if you agree", "Comment YES and I'll DM you my guide", "What's your favorite framework?". X has explicitly downranked these since 2024. [32]
6. **Same-niche-only insularity.** Replying only to the same 10 indie hacker accounts. The algorithm flags it as a clique, and the audience never grows past that cluster. [4]
7. **Disappearance during struggles.** Going silent for 3 weeks then re-emerging with "back!" Indie audiences reward continuity; "the hardest times are the best content" if framed as a lesson. [29]

### Recovery — accounts that pivoted away from these patterns

- **Marc Lou** before ShipFast had 6 years of low-engagement vague-build-in-public on bookmark-then-die projects. The pivot was specificity + dollar-amounts on every post. By Sept 2023 his ShipFast launch hit 2M impressions. [1][8]
- **Sahil Lavingia** moved Gumroad from broadcast-mode to revenue-transparency in 2018, and the build-in-public movement broadly attributes its current shape to that pivot. [22]

### What separates fake build-in-public from real

| Fake | Real |
| --- | --- |
| Streak count > shipped work | Shipped work > streak count |
| MRR screenshot, no commentary | MRR screenshot + the lever that moved the number |
| "I'm grinding" | "I tried X. It didn't work. I'm trying Y because Z." |
| Vibe-aesthetic mood-board posts | One-sentence concrete decisions |
| Quote-tweeting big accounts to be seen | Reply-as-value to mid-tier accounts to add signal |

> **Maya rule:** Before queuing a post for the user, scan for: vague pronouns ("something", "things", "soon"), unfounded superlatives ("game-changing", "revolutionary"), absent numbers. If two of three are present, rewrite or kill. (This mirrors the citation-firewall pattern in `maya-citation-firewall`.)

---

## 8. The "API-or-no-API" question for X

X's API access is hostile to indie use. Document the constraint so Maya never proposes auto-posting on the user's behalf without disclosure.

### What's readable (via ScrapeCreators)

Per `scrapecreators.com` Twitter endpoints [17]:

- **`GET /v1/twitter/profile`** — profile metadata, follower/following counts, bio, pinned tweet
- **`GET /v1/twitter/user-tweets`** — recent tweets (up to ~100 most popular)
- **`GET /v1/twitter/tweet`** — tweet detail, engagement counts, replies
- **`GET /v1/twitter/community/tweets`** — community-channel content

Limitations:
- **No native search endpoint via ScrapeCreators** (compliance). Google search with `site:x.com` queries is the documented workaround. [17]
- **Tweets capped at ~100 most popular per user.** Deep history requires alternative scrapers (twscrape, Apify) or direct X API.

### What's writeable (via X API)

- **Free tier:** 500 posts/month + 100 reads. [16]
- **Basic ($200/mo, doubled from $100 in 2026):** 10,000 posts/month. [16]
- **Pay-as-you-go (closed beta as of late 2025):** $0.01/post created, $0.005/post read. Cheaper than Basic up to ~20K posts/month. [16]
- **Pro ($5K+/mo):** 1M posts.

### The ClawLaunch decision: draft, don't post

**Maya drafts. User posts.** Reasons:
1. **API cost is unsustainable** at $19.99 Starter / $39.99 Pro pricing. 1 post per day per Pro user × 1000 users = 30K posts/month = ~$300/mo on PAYG. Not catastrophic, but not justified either.
2. **Authenticity tax.** Auto-posted indie-founder content reads as spam to the audience. The founder typing the tweet themselves is the product.
3. **Risk surface.** A bad auto-post on a creator's behalf is reputational damage Maya can't repair.
4. **Native UX.** Founders already have X open on their phone. Maya pings a draft to their channel (iMessage/WhatsApp/SMS); they paste + edit + post. Friction is acceptable here.

**Exceptions where API write-access might be worth it:**
- Studio-tier with explicit user opt-in for scheduled threads.
- Reply-mining: Maya identifies the target tweet, generates the reply, hands to user. **Never auto-replies.**

> **Maya rule:** Treat posting as user-action-required. Reading is automatable via ScrapeCreators within the 100-tweet limit. If the user demands API-write access, escalate to operator decision — not Maya's call.

---

## 9. xAI / Grok integration option

For real-time X search with citations, the ClawHub skill space offers a Grok-backed alternative to ScrapeCreators.

### The skill: `mvanhorn/xai` (and related `search-x`)

[15] Capabilities:

- Wraps xAI's Responses API (`/v1/responses`) with the `x_search` tool.
- Returns actual tweets with citations — URLs to the source posts.
- Time-filtering: last 24h, 7d, 30d, custom.
- Output modes: full results, compact, links-only, JSON.
- Filters by specific accounts or excludes bots.
- Requires `XAI_API_KEY`.

### Cost reality

[37]:
- **Grok 4.1 Fast:** $0.20/M input, $0.50/M output — 2M context.
- **Grok 4.3 (flagship):** $1.25/M input, $2.50/M output — 1M context.
- **X Search:** **$5 per 1,000 calls.**
- **Free credits:** $150/month via the data-sharing program.

### When to use Grok vs ScrapeCreators

| Scenario | Tool | Why |
| --- | --- | --- |
| Pull a user's recent posts for onboarding | ScrapeCreators | Bulk-cached, free per query in our existing infra, no LLM round-trip |
| Audience analysis (follower count, bio, engagement avg) | ScrapeCreators | Stable, cached |
| **Trend-aware search** ("what's the niche talking about right now?") | **Grok / `mvanhorn/xai`** | Real-time + cited + LLM-synthesized |
| **Reply-mining queries** ("find 10 tweets where someone asked for [tool category] in last 24h") | **Grok / `mvanhorn/xai`** | ScrapeCreators has no search; Grok has it natively |
| Competitor-pulse monitoring | Either; Grok if frequency is high | Grok at $5/1K calls = $0.005/query; ScrapeCreators per-tweet cost may exceed if querying many handles |
| Citation-required claims (Maya's grounded-or-silent rule) | **Grok** | Returns URLs by design; ScrapeCreators returns data only |

### Decision rule

> **Maya rule:** Use ScrapeCreators for "what's true about this account?". Use `mvanhorn/xai` for "what's happening in this niche right now?". The boundary is **search vs. retrieval**.

> **Maya rule:** Cap Grok x_search to **5 calls/user/day** in v0. At $5/1K calls and a 1K-user Pro tier, that's $25/day = $750/mo — manageable, gated. If a user blows the cap, queue queries; don't fail-closed silently (citation-firewall would catch it).

### Free-credit window

xAI offers $150/mo in free credits via data-sharing opt-in. **Operator decision needed:** opt in or not. Data-sharing means xAI keeps queries; for B2B indie users this may be fine. Maya should not auto-enroll.

---

## 10. Decision rules for Maya

These are the load-bearing if/then rules that govern Maya's X recommendations. Read top-to-bottom; first match wins.

1. **If the user's target audience is non-technical (consumer/lifestyle/local-service), DEMOTE X to secondary** — wrong audience. Push TikTok/IG primary. Use X only for #buildinpublic founder-network proof, never as primary acquisition. [22]
2. **If the user's product is dev-tools / B2B SaaS / AI / data / no-code, PROMOTE X to primary.** Especially below $5K MRR, where founder-led-content has the highest ROI. [22][25]
3. **If the user has <100 followers, the playbook is 80% replies, 20% original posts. Maya does not draft launch threads yet.** Phase 1 routine from § 4. [4][7]
4. **If the user has 100–500 followers, switch to Phase 2: 1 build-update/day + sustained reply rhythm + 1 Sunday recap thread/week.** [29][4]
5. **If the user has 500+ followers AND a launchable artifact, propose the 4-week pre-launch sequence (§ 6).** Below 500, refuse to coordinate a "hard launch" — cite ClearNoteLab as the failure mode. [21]
6. **If the user has <1K followers AND a B2B SaaS target, recommend X as PRIMARY for the reply-mining lane.** Most B2B founders are on X; reply-mining is highest-ROI cold-start. [22]
7. **If the user has <1K followers AND a B2C consumer app, recommend X as SECONDARY** (audience building from indie-founder credibility) while TikTok handles primary acquisition. [22]
8. **Every Maya-drafted post must contain ≥1 concrete number** (count, $, %, duration, before/after). No number → no post. Cite the source for the number in the user-facing message. (Citation-firewall pattern.)
9. **Every Maya-drafted reply must satisfy the value-first rule:** validation sentence + value-add sentence + soft mention. URL only on follow-up. [33]
10. **Never queue a reply target if the OP tweet is <5 likes, >48h old, or from a <50-follower account.** Sweet spot: 10–50 likes, <6h old.
11. **Never use hooks with hype-language** ("most important", "🚀🔥 thread of all time", "you NEED to read this"). The algorithm penalizes; the audience tunes out. [9][32]
12. **If the user has been silent on X for >7 days, Maya's first re-engagement is NOT a build update.** It's a value-add reply to someone else's tweet. Re-warm the algorithm signals before posting original.
13. **For revenue/milestone posts, REQUIRE a screenshot from a verifiable source** (Stripe dashboard, analytics, X analytics screen). Maya must see it or the post is text-only. (Citation-firewall.)
14. **Never auto-post via API.** Maya generates → user pastes. Sole exception: scheduled Studio-tier with explicit per-post opt-in.
15. **If the user has 1K+ followers AND >30 days of consistent posting AND a real shippable product, the launch thread is unlocked** (§ 6 sequence). Otherwise hold.

---

## 11. Failure stories

Real launches that got zero signups despite the founder doing "build in public." Document the breakage; Maya cites these when a user resists the playbook.

### Failure 1 — ClearNoteLab (Show HN, Dec 22 2025)

[21] Jack, a consultant in Denmark, built ClearNoteLab in 9 days using Bolt AI for $200. Launched on Hacker News at 7 AM Eastern, Dec 22, 2025.

**Result after 4 hours:** 1 point (his own upvote), 0 comments, 0 signups. Ranked #28 on Show HN.

**Root causes per his own post-mortem:**
- Launched 3 days before Christmas. Traffic at yearly lows.
- Landing page had no testimonials, no logos, no case studies.
- **0 followers on Twitter, 0 email subscribers, 2 blog posts total.** No existing audience anywhere.

**Maya's takeaway:** "Build vs distribute" is the gap. Quality doesn't guarantee distribution. Launch ≠ first signup. Pre-launch audience-building is the work; launch day is the harvest.

### Failure 2 — "2 weeks later: still no paying users"

[38] Indie Hackers post from a founder 14 days post-launch, 0 paying users despite "active on Twitter." Post-mortem:
- Posted daily but in vague terms ("working on growth", "trying new things").
- Replied only to founders in the same 50-account cluster.
- Never put the product URL in the bio.
- Never used X advanced search to find buyer-intent tweets.

**Maya's takeaway:** Phase 2 routine without Phase 1 network density doesn't compound. Reply-mining isn't optional.

### Failure 3 — The "burying" complaint

[39] DEV.to / Indie Hackers post-author built a platform after "Twitter kept burying my launches." Symptoms:
- Tweets reaching <10 followers despite ~1.5K follower count.
- Engagement velocity in first 30 min was near zero.

**Diagnosis:** Algorithm penalty stacking — likely caused by recent engagement-bait posts, all-promotional content, or repetitive launch threads with no organic engagement between.

**Maya's takeaway:** The algorithm penalizes account-level signals, not just per-tweet. One bad engagement-bait week can crater the next month of organic reach. [32]

### Failure 4 — The Black Magic platform-risk wipe

[3] Tony Dinh's Black Magic — a Twitter analytics tool — hit $14K MRR by late 2022. In Feb 2023, X hiked API fees post-Musk-acquisition; Tony's API tab went to $42K/month — 3× the product's revenue.

He sold Black Magic for $128K (after declining an earlier $500K offer that didn't close).

**Maya's takeaway:** **Don't build a product that depends on free/cheap X API access.** Reading is fragile, writing is gated. The platform-risk lesson generalizes to anyone building an X-dependent product (analytics, scheduling, AI-reply-tools).

### Failure 5 — The audience-size mirage

[7] "If your Twitter followers are fewer than a few thousand, don't start developing anything." The post argues against shipping without audience. Counter-comments cite **strzibnyj** at $40K revenue with <2K followers and **Velora** with <200 followers at thousands of customers.

**Maya's takeaway:** Follower count is not the gate. **Engaged audience × buyer-intent reach** is. A 200-follower account with 30 niche replies/week can outperform a 5K broadcast account. Don't sell the user on "get to 5K first" — sell them on "get to 100 deep niche-relationships first."

---

## Sources

1. [Marc Lou — From Flops to Million-Dollar Wins (SupaBird)](https://supabird.io/articles/marc-lou-from-flops-to-million-dollar-wins)
2. [@levelsio Nomad List founder page](https://levels.io/nomad-list-founder/)
3. [Tony Dinh — From a $105K Developer to a $1 Million Indie Hacking Marvel (SupaBird)](https://supabird.io/articles/tony-dinh-from-a-105k-developer-to-a-1-million-indie-hacking-marvel)
4. [Twitter Strategy for Indie Hackers 2026 (Teract)](https://www.teract.ai/resources/twitter-strategy-indie-hackers-2026)
5. [Daniel Vassallo — Building a $800,000 portfolio of small bets (Indie Hackers)](https://www.indiehackers.com/post/building-a-800-000-portfolio-of-small-bets-daniel-vassallo-7a5fc90f33)
6. [30 Bootstrapped Founders to Follow on Twitter (petecodes.io)](https://www.petecodes.io/bootstrapped-founders-follow-twitter/)
7. [If your Twitter followers are fewer than a few thousand, don't start developing anything (Indie Hackers)](https://www.indiehackers.com/post/if-your-twitter-followers-are-fewer-than-a-few-thousand-don-t-start-developing-anything-723d093ef4)
8. [Marc Lou's SaaS Marketing Tactics (Suraj Kadam)](https://imsurajkadam.com/marc-lous-saas-marketing-tactics/)
9. [The Anatomy of a Viral Tweet (InfluenceCraft)](https://www.influencecraft.com/blog/anatomy-viral-tweet-what-works)
10. [Marc Lou — Happy birthday, ShipFast tweet](https://x.com/marc_louvion/status/1830225355770155403)
11. [How to Go Viral on Twitter (OpenTweet)](https://opentweet.io/blog/how-to-go-viral-on-twitter)
12. [How to Use X Advanced Search in 2026 (Fedica)](https://fedica.com/blog/x-advanced-search/)
13. [Dickie Bush — Ship 30 for 30 / Twitter Threads](https://www.dickiebush.com/threads)
14. [Product Hunt Launch Guide 2026 (Calmops)](https://calmops.com/indie-hackers/product-hunt-launch-guide/)
15. [mvanhorn/xai — ClawHub skill](https://clawhub.ai/mvanhorn/xai)
16. [X API Pricing in 2026: Every Tier Explained (We Are Founders)](https://www.wearefounders.uk/the-x-api-price-hike-a-blow-to-indie-hackers/)
17. [ScrapeCreators Twitter API documentation](https://docs.scrapecreators.com/v1/twitter/profile)
18. [Tony Dinh — 1 year since I quit my job tweet](https://x.com/tdinh_me/status/1560167436724629504)
19. [@levelsio — Reached $10,000 MRR with Photo AI](https://x.com/levelsio/status/1631715500010135552)
20. [How the Twitter Algorithm Works in 2026 (Tweet Archivist)](https://www.tweetarchivist.com/how-twitter-algorithm-works-2025)
21. [I Built a SaaS in 9 Days for $200, Launched on HN to Zero Signups (Indie Hackers — ClearNoteLab)](https://www.indiehackers.com/post/i-built-a-saas-in-9-days-for-200-launched-on-hn-to-zero-signups-heres-what-actually-happened-87c39638c6)
22. [LinkedIn vs Twitter for B2B Marketing 2026 (Teract)](https://www.teract.ai/resources/linkedin-vs-twitter-b2b-2026)
23. [Arvid Kahl podcast — Vital Learnings from Bootstrapping (Indie Hackers)](https://www.indiehackers.com/podcast/140-arvid-kahl-of-feedbackpanda)
24. [Danny Postma — From a Solo Hacker (SupaBird)](https://supabird.io/articles/danny-postma-how-a-solo-hacker-built-an-ai-empire-from-bali)
25. [Senja — From Zero to $50K MRR (IndieMerger)](https://indiemerger.com/success-stories/senja-growth-story)
26. [Justin Welsh — $10M solopreneur](https://www.justinwelsh.me/)
27. [Pierre de Wulf — ScrapingBee acquired tweet](https://x.com/PierreDeWulf/status/1935602764819624187)
28. [David Ch — Reddit launch results tweet](https://x.com/chhddavid/status/1976609958989849055)
29. [Build in Public on Twitter — Complete Guide (OpenTweet)](https://opentweet.io/how-to/build-in-public-on-twitter)
30. [@levelsio — $420,000/mo revenue record tweet](https://x.com/levelsio/status/1837707857372106992)
31. [Sahil Lavingia — Gumroad February 2020 metrics tweet](https://x.com/shl/status/1237753042956509185)
32. [Engagement Bait Tactics That Secretly Hurt Your X/Twitter Growth (Success On X)](https://successonx.com/guides/what-to-avoid/twitter-engagement-bait-traps)
33. [From 0 to 1000 Followers — Strategic Path for Indie Hackers on Twitter (Wisp CMS)](https://www.wisp.blog/blog/from-0-to-1000-followers-the-strategic-path-for-indie-hackers-on-twitter)
34. [$322 → $2K MRR in 60 days by building in public (Tony Dinh newsletter)](https://news.tonydinh.com/p/322-2k-mrr-in-60-days-by-building-in-public-910564)
35. [He Made $65,000 in Just 48 Hours — Nico Jeannen's Story (Indie Hackers)](https://www.indiehackers.com/post/he-made-65-000-in-just-48-hours-nico-jeannen-s-story-3f5b29229b)
36. [Marc Lou — October 2025 revenue breakdown tweet](https://x.com/marc_louvion/status/1984327198774616533)
37. [xAI Grok API Pricing May 2026 (Rogue Marketing)](https://the-rogue-marketing.github.io/grok-xai-api-pricing-may-2026/)
38. [2 weeks later: still no paying users (Indie Hackers)](https://www.indiehackers.com/post/2-weeks-later-still-no-paying-users-heres-what-i-ve-learned-0bc55f0cdb)
39. [I Built a Platform for 500+ Indie Hackers Because Twitter Kept Burying My Launches (DEV.to)](https://dev.to/kislay/i-built-a-platform-for-500-indie-hackers-because-twitter-kept-burying-my-launches-12d4)
