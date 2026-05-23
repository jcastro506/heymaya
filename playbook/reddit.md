# Reddit Playbook — Maya GTM

This file is Maya GTM's ground truth for Reddit. She reads it on every research turn that touches Reddit. Don't paraphrase from training data — every claim here is anchored to a public URL in the Sources section at the bottom. Anything not anchored is prefixed `(unverified, common wisdom)`.

The audience this playbook serves: a solo indie / vibe-coder who just shipped, has no audience, and needs first users. Maya's job is to decide whether Reddit is the right channel for them, then operate inside it without getting them banned.

The default answer is **"probably, but slower than you think."** Reddit's 2026 anti-spam machinery is automated, retroactive, and unsentimental. A botched first week can blacklist a domain across the entire site (Takhi, Indie Hackers). The product doesn't get a second account.

### How Maya uses this file

- **Always read this file** on any research turn that mentions Reddit, Reddit posting, "where should I share my product," or reply-mining.
- **Cite the source URL** when she recommends a specific subreddit rule. Founders will push back ("is that really true?") — Maya needs the receipt ready.
- **Default to the most conservative interpretation** when two sources disagree. The downside (banned domain) is asymmetric vs. the upside (one extra post).
- **Treat `(unverified, common wisdom)` items as recommendations, not facts.** Maya can still surface them but should flag the uncertainty.
- **Reddit's own pages (`reddit.com/r/*/about/rules`, `redditinc.com`, `reddithelp.com`) are not fetchable** by Maya's research tools. Every rule cited here is via a third-party summary. When the founder is about to post, Maya should remind them to **check the live sidebar of the target sub**, because rules drift quarterly and this file is best-effort, not canonical.

---

## 1. Subreddit landscape

Subreddits are not interchangeable. The mod-rule deltas between them are larger than the audience deltas. Maya picks subs by **rule profile first, audience second**.

### r/SideProject (~444K members)

The friendliest meta-sub. Built specifically to share what you're making.

- **Self-promotion policy:** "Self-promotion is allowed if you're seeking feedback" (RedditGrowthDB). Confirmed founder-friendly across multiple Indie Hackers threads — "r/SideProject was one… I'd say r/SideProject is the best" (IH thread, amosbastian + Davey Owens).
- **What gets upvoted:** Live product link (not a waitlist, not a landing page), screenshots/GIF demo, what you learned, tech stack, roadmap, pricing context (MediaFast r/SideProject guide).
- **What gets removed:** Waitlists, landing pages with no product, pure pitch without context.
- **Karma:** Low — "A few days of commenting on other posts should give you enough karma to publish your own" (MediaFast).
- **Posting cadence:** "Once every 3-4 weeks is a good rhythm. Each post should bring something new" (MediaFast).
- **Best days/times:** Tue/Wed/Thu, 8–11 AM ET. Avoid Fri evening + Sat morning (MediaFast).
- **Title format guidance:** `[Launch] ProductName - one-liner` under 100 chars (MediaFast).
- **Example successful launches:** Comments in r/SaaS / r/SideProject ecosystem — see §3 for URLs.

### r/SaaS (~355K members)

Officially friendly. Operationally one of the strictest in 2026.

- **Self-promotion policy:** As of April 2026, **self-promotion is limited to once every 60 days** per product, counting posts, comment plugs, links, and product mentions. Alternate accounts promoting the same product are treated as one actor. Repeat violations can blacklist the product URL in AutoMod (Soar Agency).
- **What survives outside the 60-day clock:** Advice-seeking posts framed around acquisition lessons or specific tactics; the **weekly feedback thread** (the only explicitly sanctioned promo lane).
- **What gets removed:** "No direct sales or non-productive self-promotion… Overdoing it results in a ban" (RedditAgency r/SaaS). Blog-post links must include the main idea in the post body — the link goes at the end as "Originally posted here" (RedditAgency r/SaaS).
- **Karma / participation:** AutoMod is **auto-removing posters with no prior subreddit participation** as of April 2026. AutoMod message reportedly reads: "no participation in r/SaaS yet" — needed to "earn subreddit karma through helpful comments before posting" (Soar Agency).
- **Account age:** Not numerically published; implicitly enforced via the participation gate above.
- **Required flair:** Not documented for posts; weekly feedback thread is the lane.

### r/microsaas (~50K members)

Smaller cousin to r/SaaS. Lower bar, narrower niche.

- **Self-promotion policy:** Founder reports describe it as "more accepting of promotional content" (RedditGrowthDB).
- **What gets upvoted:** Bootstrapped, sub-$10K MRR, niche-tool stories. The community skews tiny-revenue founders.
- **Karma / age:** Not publicly documented. Treat as low-bar but not zero.
- **(unverified, common wisdom):** Same anti-spam reflex as the bigger meta-subs — never first-post a link with no context.

### r/Entrepreneur (~4.8M members)

Big, broad, and mod-heavy. Easiest to get removed in.

- **Self-promotion policy:** "Self-promotion is allowed in context. Lead with value, not your product. Promotional posts may be removed" (RedditAgency r/Entrepreneur). Direct "check out my product" posts get removed (Reddit Radar).
- **Karma gate:** **Minimum 10 subreddit karma** before posting (RedditGrowthDB).
- **What gets removed:**
  - "I built X, AMA" posts without substantive value
  - Feedback requests lacking detail
  - Marketing jargon ("game-changing," "revolutionary")
  - Affiliate links
  - Excessive promotional comments → mod ban
  - Link-only posts (RedditAgency r/Entrepreneur)
- **Designated promo thread:** Weekly self-promotion threads exist (Reply Agent).
- **What gets upvoted:** Success stories, case studies, lessons learned — product mentions must "emerge naturally" (Reddit Radar). Personal accounts outperform business-named accounts.

### r/startups (~1.9M members)

Story-forward. No tolerance for direct links.

- **Self-promotion policy:** "No direct sales, advertisements, or promotional posts of any kind" outside the **monthly Share Your Startup thread** (RedditAgency r/startups + RedditGrowthDB).
- **Designated promo thread:** Monthly **"Share Your Startup"** sticky.
- **Post length minimum:** **250 characters of content** (RedditAgency r/startups).
- **What gets removed:**
  - Posts without 250+ chars
  - Affiliate links
  - PM solicitation ("DM me," "happy to share more in DMs")
  - Blog content without prior mod approval (full content required if under 2000 words)
  - Unscheduled AMAs (need 2-week mod lead time)
  - "Most promotional content is removed" (RedditGrowthDB)
- **Link-in-comments rule:** Acceptable, but require "at least a sentence explaining why the link is relevant" (RedditAgency r/startups).

### r/IndieHackers (~98K members)

Most generous official self-promotion lane on this list.

- **Self-promotion policy:** "Users can self promote their product 1 time using the SHOW IH flair. The purpose is for feedback and critique not advertisement" (RedditAgency r/indiehackers + RedditGrowthDB).
- **What works:** Monthly revenue updates, build-in-public reflections, post-mortems (Reply Agent + Refined).
- **Karma / age:** Not specifically gated above Reddit baseline.
- **Risk:** One shot. Burn it on a weak post and the lane closes.

### r/buildinpublic (~varies)

Story sub, not launch sub. Treat it as "show your progress," not "drive traffic."

- **Rules (verbatim list from RedditAgency r/buildinpublic):**
  1. Be Respectful — "No harassment, hate speech, or personal attacks will be tolerated"
  2. Stay on Topic — building in public, product work, skill development, launches
  3. **No Self-Promotion Without Context** — "Share progress and lessons learned rather than purely promotional content"
  4. No Spam — "Spamming links, irrelevant content, or unsolicited advertisements will lead to immediate removal"
  5. No Plagiarism
  6. Privacy
  7. Transparency in Tools — "Clearly indicate whether shared resources are paid, free, or affiliate-linked"
- **What gets upvoted:** Milestones (revenue updates, wins, failures), vulnerability about struggles, free resources.

### r/EntrepreneurRideAlong

Active-build sub. Frames itself as the place to *ride along* with a founder's journey — story-first, not pitch-first.

- **Self-promotion policy:** Community rules (per Redplus / GummySearch summaries) require: respectful and kind tone, no spam or unsolicited offers, **self-promotion only when it carries community value**, adherence to Reddit global rules, engagement with good intent, and **no posts linking to newsletters or free services as the primary CTA**.
- **What works:** Active build posts, weekly progress shares, what-I-tried-and-failed posts. Treat each post as "episode N of my build journey," not "buy my thing."
- **Karma / age:** Not publicly documented. Default to the §6 baseline before posting.
- **Listed on multiple curated lists** (Baretto's 12 subs, mmccaff PlacesToPostYourStartup) as tolerant — but that tolerance is conditional on the journey framing above.

### r/coolgithubprojects

OSS / dev-tool wedge. Friendlier than r/programming for indie projects with a public repo.

- **Self-promotion policy:** "Accepts project submissions and usually provides some feedback" (DEV community comment).
- **What works:** A working GitHub link is required. Treat the README as the actual pitch — Reddit body just frames it.
- **Karma / age:** Not publicly documented.

### r/programming (~4M members) — RISKY

The default answer is **do not launch here.** Treat r/programming as a content channel for *technical writeups,* never for product launches.

- **Policy:** "Stricter" with "Focus on technical value" (RedditGrowthDB). What's acceptable in r/SaaS will get you instantly banned in r/programming (Reply Agent / JetThoughts).
- **What's allowed:** "Technically accurate, polished, and pedagogically sound" resources where "post body contains more than just a link" and explains "what the resource is teaching and how it improves on the status quo" (JetThoughts).
- **What's banned:** Learning content (belongs in r/learnprogramming), product pitches, blog spam, anything that "feels spammy" (JetThoughts).
- **(unverified, common wisdom):** The only winning shape here is "I solved X technical problem and the solution involves my tool as a footnote." Even that gets brigaded.

### Niche subs — the actual playbook

The pattern: **meta-subs (r/SaaS, r/startups, r/Entrepreneur) are crowded and rule-heavy; niche subs convert better and rule-enforce lighter, but only if the founder is a real participant there.**

> "Smaller, niche communities almost always deliver better results… When launching a productivity app, you shouldn't just post in r/productivity but might find deeper engagement in r/GetDisciplined or r/DecidingToBeBetter, and dedicated app subreddits like r/iosapps or r/macapps would help as well." — SingleGrain

> "A subreddit with 500,000 members but only a handful of comments per post is less useful than one with 20,000 members where every post sparks discussion." — SingleGrain

### r/InternetIsBeautiful — the volume sub

Worth calling out separately because Marc Lou's documented result was **47,000 visitors in 24 hours from a single post** (Marc Lou's "How To Launch a Startup on Reddit" newsletter; the post is also referenced in mean.ceo's launch coverage).

- **Self-promotion policy:** "Doesn't allow products that have a sign-up" — Marc Lou's workaround was query parameters and hidden pricing / email-capture replacements (Refined).
- **What works:** Fun, single-purpose, novelty-shaped tools that work without an account. Sharp titles in the form "I made a site to [user benefit]" (Marc Lou).
- **What fails:** Anything that looks like a B2B SaaS landing page; anything that requires a paid plan on first interaction.
- **Karma / age:** Not documented. Treat as high-bar AutoMod given the sub's broad audience.

Companion sub: **r/dataisbeautiful** for data-viz projects with the same shape (Marc Lou).

- **Productivity tool** → r/productivity, r/GetDisciplined, r/DecidingToBeBetter (SingleGrain)
- **iOS/Mac app** → r/iosapps, r/macapps (SingleGrain)
- **No-code product** → r/nocode — has "monthly launch threads available" (RedditGrowthDB)
- **Webdev / framework tool** → r/webdev ("contextual links welcome" per RedditGrowthDB), r/javascript, r/reactjs, r/nextjs, r/node, r/tailwindcss
- **Bootstrapped / lean** → r/bootstrapped, r/leanstartup, r/microstartups
- **Beta testers wanted** → r/AlphaAndBetaUsers ("designed for finding beta testers. Post your product freely" — RedditGrowthDB)
- **Roasts wanted** → r/RoastMyStartup, r/startupfeedback ("dedicated feedback community" — RedditGrowthDB)
- **Showcase** → r/IMadeThis, r/IndieBiz, r/growmybusiness
- **Sales-y allowed** → r/shamelessplug, r/plugyourproduct (mmccaff PlacesToPostYourStartup)
- **Marketing-adjacent** → r/marketing ("zero tolerance for self-promotion" per RedditGrowthDB — avoid), r/GrowthHacking, r/Emailmarketing, r/SEO, r/Copywriting, r/affiliatemarketing

Maya's pattern: **find the smallest sub where the founder's user actually hangs out, then check that sub's pinned mod posts before recommending it.**

### Funnel-stage framing (Reddalyze / SingleGrain)

Subreddits also map to funnel stages. Maya should classify each candidate sub before recommending, because mismatched-stage posts get downvoted even when rule-compliant:

- **Awareness stage** — general industry discussions (r/Entrepreneur, r/smallbusiness, r/marketing). These are top-of-funnel; expect curiosity, not signups.
- **Consideration stage** — comparison threads, "alternatives to X" posts (often in product-specific subs and r/SaaS). The mid-funnel sweet spot for soft mentions in replies.
- **Decision stage** — specific tool / brand subs where users share detailed implementation experiences (r/Notion, r/Obsidian, r/airtable). Highest conversion intent; strictest community norms because users are protective of their tools. Real data point: one founder reports being **banned from r/Notion after just two self-promotion posts** (Conbersa). Maya should treat decision-stage subs as **reply-only territory** — never post a launch there; only contribute when directly relevant.

### How to find the niche sub for any product

Three-step heuristic synthesized from SingleGrain + Reddalyze:

1. **Search Reddit** for the founder's competitors' product names. The subs where competitor discussions cluster = the founder's target subs.
2. **Sort each candidate sub by "Top" of the past 3–12 months.** Tag the recurring pain points. If those pain points match the founder's product → bingo. If not → wrong sub.
3. **Member-to-comments ratio matters more than raw size.** "A subreddit with 500K members but a handful of comments per post is less useful than one with 20K members where every post sparks discussion" (SingleGrain). Maya should look for active comment threads, not subscriber vanity numbers.

---

## 2. The 9:1 doctrine

The "9 helpful comments before 1 self-promotion" heuristic is real but its provenance is more nuanced than commonly stated.

### Where it comes from

- **Original source:** Reddit's own early reddiquette page published a 90/10 rule: "for every 1 self-promotional post, you should have 9 non-promotional ones" (KarmaGuy).
- **Status today:** "Reddit published this as official guidance in their early years but retired the rule because it was too rigid" (Reply Agent). KarmaGuy: "Reddit retired this guideline because it was 'too rigid' and 'gaming-friendly.'" Reddit replaced the formal rule with a simpler principle: *be a genuine participant, not just a promoter.*
- **Effective ratio in 2026:** "Most experienced Reddit marketers follow something closer to 95/5" (Reply Agent). OnlineModeration cites the 90/10 as still "the official reddiquette guideline" in spirit.

### What it actually means operationally

It is not a per-post ratio. It is an **account-history ratio**. Mods click your username, scan recent activity, and decide if you look like a person or a billboard (Reply Agent):

> "If every comment mentions the same product, that's a red flag. If posting history shows diverse, helpful participation across topics, a product mention looks natural."

Founder quotes from Indie Hackers reinforce this:

> "FIRST - Provide Upfront Value / THEN, subtly plug your site." — IH commenter on Nithin Jawahar's "Hacking Reddit" thread

> "It's not for self promotion. It's for collecting feedback. If you are just posting your thing there to promote it, you are doing it wrong." — IH commenter on the "what subreddits allow self-promotion" thread

> "Reddit communities respect transparency and punish deception. Adding disclosures like 'Full disclosure: I built this' actually increases trust rather than hurting it." — KarmaGuy

### Maya's read

The 9:1 isn't a quota. It is a **shape rule for an account**. If a username's last 30 contributions, scanned in 10 seconds, look like a person who happens to have shipped a thing → safe. If they look like a thing that happens to have a Reddit account → banned.

Reddit's most-cited operating maxim, from Reply Agent / the original reddiquette: **"It's perfectly fine to be a Redditor with a website, it's not okay to be a website with a Reddit account."**

---

## 3. Post anatomy

### Title patterns that win

Five archetypes verified against real high-performing launch URLs (GrowthExe templates + real r/SaaS examples):

1. **Time-investment hook** — "I spent X months/hours building this" (e.g. [r/learnprogramming/comments/7mhi6x](https://www.reddit.com/r/learnprogramming/comments/7mhi6x/spent_the_last_6_months_building_a_programming/))
2. **Emotional reframing** — "Spent [time] building [thing], what do you think?" Centers the human, not the feature.
3. **Expectation vs. reality** — "I thought [assumption], here's what actually happened" (e.g. [r/ChatGPTCoding/comments/1iuw85i](https://www.reddit.com/r/ChatGPTCoding/comments/1iuw85i/i_thought_ai_would_build_my_app_for_me_heres_what/))
4. **Milestone narrative** — "It finally happened, got my first paying user today" (e.g. [r/SaaS/comments/1l4l04i](https://www.reddit.com/r/SaaS/comments/1l4l04i/it_finally_happened_got_my_first_paying_user_today/)) or "Just hit $5K with my SaaS in 8 weeks" ([r/SaaS/comments/1l0r68d](https://www.reddit.com/r/SaaS/comments/1l0r68d/just_hit_5k_with_my_saas_in_8_weeks_what_worked/))
5. **Value bomb** — "I analyzed 10K top posts on r/SaaS, 5 post types that work" ([r/SaaS/comments/1ljh5ia](https://www.reddit.com/r/SaaS/comments/1ljh5ia/i_analyzed_10k_top_posts_on_rsaas_5_post_types/))

**Anti-patterns** (RedShip / RedditAgency r/Entrepreneur):

- "Introducing [Product], an AI-powered [thing]" — feature-led, gets removed
- "I built X, AMA" without value — flagged as low-effort in r/Entrepreneur
- Marketing jargon ("game-changing," "revolutionary," "next-gen")
- Emojis in title (variable by sub; r/Entrepreneur strips them via AutoMod per common reports)

### Body structure (problem → story → ask → URL)

RedShip's verified pattern:

1. **Lead with the problem** (not the product)
2. **Personal founder narrative** — discovery, prior attempts, motivation
3. **Visual proof** — screenshots, demo video, before/after
4. **Community value proposition** — what the reader gets (free trial, feedback request, exclusive access)
5. **Transparent disclosure** — pricing, limitations, "Full disclosure: I built this"

RedditAgency r/SaaS adds: **"Main ideas must appear in the Reddit post itself, not just the link… Links allowed only at the end ('Originally posted here') unless highly relevant."**

### URL placement — when comments-only is required

Three-rule system synthesized from Bitly + RedditAgency r/SaaS + RedditAgency r/startups + Marc Lou's r/SideProject playbook:

- **URL in body** is allowed when "the surrounding text is meaty enough that the link feels like a citation, not an ad" (Bitly). r/SaaS requires the link sit at the end with "Originally posted here" framing.
- **URL in first comment** is the safer default in strict subs. Add context — "naked URL" first comments get auto-spam-bot flagged (Bitly). Marc Lou's documented r/SideProject pattern: "post website link in first comment (not title)" and engage with all replies (Marc Lou).
- **URL in body, hidden** (e.g. mentioned only in subsequent comments when asked) is the safest move in r/Entrepreneur, r/marketing, and r/programming.

The first-comment pattern has a secondary benefit Maya should know: posting the URL as the first comment gives the founder one extra notification surface — the comment gets its own upvote counter, replies thread separately, and edits don't affect the post body.

### Karma threshold for self-promo subs

- **r/Entrepreneur:** 10 subreddit karma (RedditGrowthDB)
- **r/SideProject:** "A few days of commenting" — effectively single-digit karma (MediaFast)
- **r/SaaS:** No public number, but AutoMod enforces "earn subreddit karma through helpful comments before posting" (Soar)
- **General Reddit baseline:** "200–300 karma before attempting any product mentions" is common practice (Growthner). AutoMod thresholds by sub size (Upvote.net):
  - Medium (50K–500K): 50–200 comment karma
  - Large (500K–5M): 200–500 comment karma
  - Major (5M+): 500–2,000 comment karma

### Five real successful launch posts (with anatomy)

All five sourced from Popsy's "examples" guide. Maya should cite these when justifying recommendations to a founder.

1. **["I quit my job to focus full time on SaaS"](https://www.reddit.com/r/SaaS/comments/1hn9d64/i_quit_my_job_to_focus_full_time_on_saas/)** — Personal-stakes narrative; product introduced as part of the journey, not the headline.
2. **["I raised $2.5M ten years ago, here's what I learned"](https://www.reddit.com/r/SaaS/comments/1ljtkzt/i_raised_25m_ten_years_ago_heres_what_i_learned/)** — Authority-from-experience post; product mention buried.
3. **["It finally happened, got my first paying user today"](https://www.reddit.com/r/SaaS/comments/1l4l04i/it_finally_happened_got_my_first_paying_user_today/)** — Milestone celebration; product mentioned by name in body.
4. **["Just hit $5K with my SaaS in 8 weeks, what worked"](https://www.reddit.com/r/SaaS/comments/1l0r68d/just_hit_5k_with_my_saas_in_8_weeks_what_worked/)** — Numbers + lessons; product is the case study.
5. **["I analyzed 10K top posts on r/SaaS, 5 post types"](https://www.reddit.com/r/SaaS/comments/1ljh5ia/i_analyzed_10k_top_posts_on_rsaas_5_post_types/)** — Value-bomb data post; founder credibility carries the product mention.

Common anatomy across all five: **first-person, specific number or moment, lesson the reader can take home, product as supporting detail rather than headline.**

### Timing window — the 2-hour rule

Reddit's ranking algorithm front-loads engagement within the first 1–2 hours. Multiple sources converge on this (RedShip, mean.ceo, Marc Lou):

> "Be available for the first 2 hours after posting. Respond to every comment quickly. Early engagement signals to Reddit's algorithm that your post is worth showing to more people." — mean.ceo

> "Respond to every comment within the first 2 hours" — RedShip

Practical implication for Maya: never recommend a Reddit launch when the founder is about to be unavailable. A post on a Tuesday morning that the founder can't tend until evening will underperform a post on Wednesday morning that they can babysit. Tell the founder to **post the URL as the first comment immediately after publishing** (Marc Lou) and to refresh notifications for 90 minutes.

### Pre-write the first comment

Standard pattern (synthesized from Marc Lou + MediaFast + RedShip): Maya should help the founder draft the first comment **before** they post. It should contain:

1. The product URL
2. A two-sentence "why I made this" context that the title couldn't fit
3. An explicit invitation to feedback ("would love to hear what works, what's broken")
4. The founder's stake: "(founder, building solo)" — disclosure builds trust per KarmaGuy.

---

## 4. Reply-mining playbook

Replies convert better than posts for a no-audience indie founder. Posts ask Reddit to come to you; replies put the founder where buyers are already mid-decision.

### Search queries that surface buyer intent

Anchor: Indie Hackers playbook (Leado.co founder) + CatchIntent + IH "my playbook for using Reddit lead gen."

Three verified evaluation-language patterns:

- `"looking for a tool that…"`
- `"evaluating alternatives"`
- `"has anyone replaced [competitor]?"`
- `"how do you choose between [X] and [Y]?"`
- `"alternatives to [competitor]"`
- `"anyone using [competitor]"`
- `"is [competitor] worth it"`
- `"frustrated with [competitor]"`
- `"[competitor] is too expensive"`

The IH "track problems, not topics" rule (Leado playbook):

> "Tracking 'Email Marketing' is noise. Tracking 'Mailchimp is too expensive' or 'Open rates are dropping' is signal."

### Where to mine

Per IH playbook + CatchIntent: r/SaaS, r/startups, r/sales, r/marketing, r/devops, r/analytics, **plus the founder's specific niche subs**. The niche subs are where conversion happens because the audience is pre-qualified.

### Reply structure (3-paragraph framework, verbatim from Leado IH post)

1. **Validation** — "I had this issue with [competitor] too…"
2. **Value provision** — "I switched to [generic solution / approach]…"
3. **Soft pitch** — "I actually built a tool to fix this, you can check it out here if you want"

The soft pitch is **conditional, not automatic**. From the IH playbook:

> "If you use a Reddit lead generation tool to spam links, you will fail."

### 10 reply frameworks (mean.ceo's catalog)

Maya should pick the framework that best fits the OP's question, not default to "validation/value/soft pitch" every time. The 3-paragraph above is one of these ten:

1. **Been there, done that** — Share lived experience with the same problem, admit what failed initially, explain what changed. Example pattern (mean.ceo): *"I had this exact problem last year when we were testing founder education flows. My first move was to add more features, which made it worse. What helped was stripping the process down and watching where users dropped off."*
2. **Counterintuitive insight** — Acknowledge common advice, explain why it failed for you, reveal the less obvious solution.
3. **Tactical mini playbook** — 3–5 concise steps; proves competence without grandstanding.
4. **Mistake warning** — Validate the OP's direction, flag predictable traps, suggest safer alternatives.
5. **Data point drop** — One concrete number that shows what changed. Stop before bragging.
6. **Question flip** — Short answer, then a clarifying question that reframes the discussion. Often gets more replies than the original.
7. **Respectful disagreement** — Acknowledge valid parts of opposing views, share different experience, explain when each applies. Builds authority without being combative.
8. **Tool-neutral recommendation** — Present 2–4 options, mention the founder's tool as one of them. Hardest to remove because it doesn't read as promo.
9. **Lessons learned summary** — Name what worked, what failed, end with balanced recommendation.
10. **Quiet authority** — State observed patterns, explain common causes, suggest simple fixes without claims of expertise.

The mean.ceo principle Maya should hard-code:

> "If your comment can be deleted and still help, the mention is probably safe. If deleting it removes the whole purpose, it was probably an ad."

### When to NOT mention the product

- The thread is about a different problem than the product solves.
- The OP has already chosen a tool and is asking *implementation* questions.
- The thread is older than 7 days (relevance decay + necro-bumping is suspicious to mods).
- The subreddit prohibits product mentions in comments (r/marketing, r/programming, r/technology, r/AskReddit).
- The founder has commented in the same sub <24h ago with a similar pitch.
- The product genuinely doesn't fit. Saying "this isn't the right tool for you, try X" earns more trust than mentioning the founder's own thing.

### How to detect promotion risk before replying

Maya's pre-flight checklist:

- Is this sub on a "no promotion in comments" blacklist? (r/marketing, r/programming, r/technology, r/AskReddit, r/personalfinance)
- Has the founder commented + mentioned product in this sub in the last 7 days?
- Is the OP's question phrased generically ("how do I X") or narrowly ("does anyone here use X feature in Y tool")? Generic = safer to suggest; narrow = stay silent unless directly fit.
- Does the founder's last 10 comments contain >2 mentions of their own product? If yes → wait, build participation first.
- Has the comment chain already had 1+ founder-shilling reply? Don't pile on.

### Real examples (URLs)

- [Indie Hackers — "My playbook for using a Reddit lead generation tool to find high-intent buyers"](https://www.indiehackers.com/post/my-playbook-for-using-a-reddit-lead-generation-tool-to-find-high-intent-buyers-43b42994cc) — the 3-paragraph reply framework above
- [Indie Hackers — "I built a tool that finds your first customers by searching Reddit threads with real buying intent"](https://www.indiehackers.com/post/i-built-a-tool-that-finds-your-first-customers-by-searching-reddit-threads-with-real-buying-intent-playbook-e54c60036b) — the evaluation-language taxonomy

---

## 5. Subreddit-specific rules summary table

The numbers below are what's publicly verifiable. Anything blank is genuinely unverified — Maya should treat blank as "ask the founder to check the sidebar before recommending."

| Subreddit | Karma min | Account age | Post freq cap | Required flair / format | Notable AutoMod triggers |
|---|---|---|---|---|---|
| r/SideProject | "few days of commenting" (≈single digits) | not stated | 1 / 3-4 weeks (recommended) | `[Launch] Name - one-liner`, <100 chars | waitlist-only links, no live URL |
| r/SaaS | "no participation" AutoMod gate (Apr 2026) | not stated | **1 product mention per 60 days** | weekly feedback thread for promo | repeated product mentions across alt accounts, link-only posts |
| r/microsaas | not documented | not documented | not documented | none documented | (unverified) standard anti-spam |
| r/Entrepreneur | **10 subreddit karma** | not stated | not documented | no jargon, no affiliate, descriptive title | "game-changing," "revolutionary," affiliate links, link-only posts, emoji-heavy titles |
| r/startups | not stated | not stated | once / month via Share Your Startup | **250 char minimum body**; no blogs without mod approval | <250 chars, affiliate links, "DM me," PMs solicitation, unscheduled AMAs |
| r/IndieHackers | not stated | not stated | **1 lifetime SHOW IH post** | **SHOW IH flair required** for self-promo | misuse of SHOW IH for non-feedback posts |
| r/buildinpublic | not stated | not stated | not documented | progress-framing required | spam links, hidden affiliate links |
| r/EntrepreneurRideAlong | not documented | not documented | not documented | not documented | (unverified) standard anti-spam |
| r/coolgithubprojects | not documented | not documented | not documented | working GitHub link | non-GitHub links, closed-source pitches |
| r/programming | not stated (but high) | high (implicit) | rare | technical writeup format only | product pitches, learning content (→ r/learnprogramming), blog spam |
| r/nocode | not stated | not stated | monthly launch thread | monthly launch thread | not documented |
| r/AlphaAndBetaUsers | none stated | none stated | per sub norm | "Post your product freely" | not documented |
| r/marketing | high | high | n/a — **don't promote here** | n/a | "zero tolerance for self-promotion" |

(Sources for the above all live in the Sources section: RedditGrowthDB, Soar Agency, RedditAgency r/SaaS / r/startups / r/Entrepreneur / r/indiehackers / r/buildinpublic, MediaFast, Reply Agent, Refined, Upvote.net AutoMod.)

---

## 6. Anti-spam / shadow-ban triggers

Reddit's spam machinery in 2026 is mostly automated. Reddit's own H1 2024 Transparency Report (cited via KarmaGuy) puts the automated-detection rate at **96.4% of content manipulation.** A shadowban means your posts look live to you but are invisible to everyone else (KarmaGuy).

### Documented automated triggers

From Multilogin's 2026 shadowban guide + KarmaGuy + Upvote.net AutoMod:

- **Posting the same link repeatedly across multiple subreddits** — single biggest trigger
- **Commenting the same generic response across threads** — duplicate text detection
- **Posting to more than 2-3 similar subreddits in the same week** with the same content
- **New accounts that immediately start posting at high volume** — age/activity mismatch
- **Repeatedly posting links to the same domain, especially new or low-reputation domains** — domain reputation tracking
- **Creating an account from an IP address previously used by banned/spam accounts** — IP reputation
- **VPN/proxy use from flagged exit nodes**, datacenter IPs, shared commercial IPs
- **Vote manipulation patterns** between accounts (e.g. coordinated upvotes within minutes)
- **Accounts posting in the same threads within short windows** — coordinated activity

### Hard numbers (cited but not Reddit-official)

From Multilogin shadowban guide — treat as community-observed thresholds, not Reddit policy:

- **>5–8 posts per day from a single account** triggers rate-limiting and eventually a shadowban
- **Space posts at least 45 minutes apart**
- **2–4 weeks of genuine contribution** before promotional content is the prevention period
- **10:1 ratio** ("for every one promotional post or link, you should have nine genuine contributions")

### Domain blacklisting

The nuclear consequence. From Takhi (Indie Hackers) and Soar Agency:

> "If your SaaS link gets reported, Reddit can blacklist that URL across the entire site. Creating new accounts won't bypass this penalty." — Takhi, IH

> "Repeat violations can blacklist the product URL in AutoMod… along with potential bans and deletion of prior submissions." — Soar Agency r/SaaS

This is why Maya's first-week rule is so conservative: a domain blacklist is unrecoverable without buying a new domain.

### Link-shortener use

Not explicitly documented as a shadowban trigger, but every guide reviewed flags link shorteners (bit.ly, etc.) as **AutoMod-prone in moderated subs** because shorteners hide the destination domain and bypass domain-reputation tracking. (unverified, common wisdom): Never use a shortener in r/SaaS, r/startups, r/Entrepreneur, or any sub with active AutoMod.

### Follow-up posts within 24h

(unverified, common wisdom): Mods read this as either (a) post-failed-trying-again or (b) coordinated spam. Wait 7+ days between launch-shaped posts in the same sub.

### Shadowban detection

Logged-out test: view your profile in an incognito window. If your posts appear → fine. If they're missing → shadowbanned (KarmaGuy).

Also: third-party tools like RedShip's free Reddit Shadowban Checker and Multilogin's diagnostic exist. Maya should recommend the logged-out incognito test first because it requires no third-party trust.

### Recovery if banned

Three escalation paths (Multilogin / KarmaGuy / Takhi IH):

1. **Subreddit ban** — DM the moderators (via "Message the mods" on the sub sidebar), apologize, ask what rule was violated. Roughly 40–60% reversal rate on first-time, low-volume infractions per Multilogin's anecdata.
2. **Site-wide shadowban** — File a Reddit Help request explaining your activity and waiting period. No SLA; replies can take 1–4 weeks.
3. **Domain blacklist** — Generally unrecoverable. Switch domains is the standard advice. This is the single biggest reason Maya's first-week recommendations are conservative — losing the domain is worse than losing the account.

### What never recovers

- Domain blacklisted across Reddit (per Takhi)
- Multiple accounts banned from same IP (account creation from that IP becomes flagged)
- Karma manipulation found by Reddit anti-cheat (vote-trading, paid upvote services) — site-wide ban with no appeal historically

---

## 7. The "Show HN equivalent" question

There is no single Show HN of Reddit. There are several lanes, each smaller and more rule-bound than Show HN itself.

### Closest equivalents

| Lane | Equivalent shape | Notes |
|---|---|---|
| **r/SideProject** | Closest meta-equivalent | Self-promotion encouraged with feedback ask; live product required; founder ecosystem confirms it as "the best" sub for this (IH thread). |
| **r/IndieHackers — SHOW IH flair** | One-shot Show HN | Lifetime cap of 1 SHOW IH post. Use it on the strongest launch, not the first soft launch. |
| **r/startups — monthly Share Your Startup** | Sticky thread Show HN | Monthly cycle. Throwaway impact unless you stack with niche-sub replies. |
| **r/SaaS — weekly feedback thread** | Sticky thread Show HN | The only sanctioned promo lane in r/SaaS outside the 60-day rule. |
| **r/nocode — monthly launch thread** | Niche Show HN | Lower volume but pre-qualified audience. |
| **r/coolgithubprojects** | OSS Show HN | Requires GitHub link; pattern-matches Show HN ethos closer than any meta-sub. |

### Structural difference vs Show HN

Show HN is a single global queue. Reddit's "Show HN" is **a federated set of weekly/monthly stickies**, each with its own moderator culture. A founder who launches on r/SaaS Friday + r/startups monthly Share Your Startup + r/SideProject Tue/Wed/Thu in the same week is doing the closest thing to Show HN — but each post must be rewritten for that sub's culture, not cross-posted identically (that's a shadowban trigger per §6).

### What replaces "Show HN" as a single hit

In 2026, the practical answer is **Reddit weekly stickies + Product Hunt + Indie Hackers Show IH + Hacker News Show HN** as a synchronized 5-post launch week, with niche-sub *replies* in the same week doing the actual conversion work (per §4). ScrollLaunch and Smol Launch list Reddit alongside Product Hunt, Indie Hackers, Uneed, SideProjectors, MicroLaunch, DevHunt as the standard "Show HN alternative" stack.

---

## 7b. Launch week schedule (Maya's calendar template)

This is the synchronized launch week Maya should propose when a founder has done their 2-4 week warmup and is ready to ship. All scheduling logic anchored to the founder's local timezone but normalized to US ET because that's where Reddit's daytime activity peaks (MediaFast).

| Day | Move | Sub | Notes |
|---|---|---|---|
| Mon (T-1) | Final post draft + first comment draft + screenshots | — | Cleared with §3 anatomy + §6 anti-spam check |
| Tue 8–11am ET | Launch post #1 | r/SideProject | "Live product link in body OR first comment" — engage hard for first 2 hours |
| Tue + Wed | Reply-mine niche sub | niche sub | Use §4 three-paragraph framework on 5–10 buyer-intent threads |
| Wed 8–11am ET | Launch post #2 | r/coolgithubprojects OR niche sub | Only if product fits the sub; rewrite, don't cross-post |
| Thu | r/SaaS weekly feedback thread (if Friday) OR r/IndieHackers SHOW IH | r/SaaS / r/IndieHackers | The lifetime SHOW IH shot — save for product's strongest week |
| Thu / Fri | More reply-mining + comment on own launches | — | Keep engagement signal alive |
| Following month | r/startups Share Your Startup sticky | r/startups | First or second day of the month, with refined narrative + metrics from week 1 |

**What Maya should never recommend in this calendar:**

- Same content cross-posted Mon–Tue–Wed across multiple subs (§6 shadowban trigger)
- Two main-feed launch posts in the same sub within 7 days
- A r/SaaS main-feed post in week 1 (burns the 60-day clock)
- A r/programming post in week 1 (very high risk; defer to week 4+ if at all)
- Reddit launches when the founder will be in deep work / offline for the post's first 2 hours

## 8. Decision rules for Maya

These rules are written for Maya to consult before recommending any Reddit move. They're conservative on purpose — the downside of a bad recommendation (domain blacklist, account ban) is worse than the upside of a fast launch.

1. **If the founder's Reddit account is <30 days old**, do NOT recommend Reddit as primary channel for week 1. Recommend X/Twitter community engagement + warm-network DMs while the account ages. Surface this as: *"Reddit's automated spam filter is hostile to new accounts. You'd burn the channel by launching today. Let's warm your account for 2–4 weeks while we drive first users from elsewhere."*

2. **If the founder's account has <10 subreddit karma in their best-fit niche sub**, no posting yet. Recommend 5–10 helpful comments in that sub first. Cite r/Entrepreneur's 10-karma minimum as the floor.

3. **If the product is B2C consumer + has <100 followers anywhere**, recommend r/SideProject (Tue/Wed/Thu 8–11am ET) as launch #1 + reply-mining in the niche sub (per §4) for week 1. Skip the meta-subs (r/SaaS, r/Entrepreneur, r/startups) until karma exists.

4. **If the product is B2B SaaS**, default to the r/SaaS weekly feedback thread + monthly r/startups Share Your Startup + niche-sub reply-mining. Do NOT post a main-feed r/SaaS post unless the founder is okay burning their 60-day clock.

5. **If the product is a dev tool / OSS / has a public repo**, recommend r/coolgithubprojects + the niche language/framework sub (r/javascript, r/reactjs, r/nextjs, r/webdev). Stay out of r/programming entirely.

6. **If the founder asks about r/programming**, recommend against it. Suggest a *technical writeup* in r/programming only if (a) the writeup is genuinely teaching something, (b) the product is mentioned only as a footnote, (c) the founder has 500+ karma in r/programming already. Otherwise: r/coolgithubprojects or the niche framework sub.

7. **If the founder wants to cross-post the same content to >2 subs in a week**, block it. Rewrite each post for the target sub's culture or stage them across 7+ days. Cite §6 (identical-post detection is a top shadowban trigger).

8. **If the post is in a strict sub (r/Entrepreneur, r/startups, r/SaaS)**, force the URL into the first comment, not the body. Cite Bitly + RedditAgency r/SaaS rule that body links must read as citations, not ads.

9. **If the founder hasn't shipped a live product yet** (only landing page + waitlist), do NOT recommend r/SideProject. The community is explicit: "Link to the live product: Not a waitlist, not a landing page with no product" (MediaFast). Recommend r/AlphaAndBetaUsers instead — it explicitly welcomes pre-launch posts.

10. **If the founder is doing reply-mining**, enforce the 3-paragraph structure (validation / value / soft pitch) from §4. Block any reply where the product mention comes in paragraph 1.

11. **If the founder's last comment on the sub mentioned their product within the last 7 days**, skip mentioning it again. Recommend a value-only reply, then mention the product on the *next* thread.

12. **If the sub is r/marketing, r/programming, r/technology, r/AskReddit, or r/personalfinance**, never recommend a product mention in posts or comments. Treat as read-only research subs.

13. **If the founder uses a link shortener (bit.ly etc.)**, swap it for the canonical domain. Cite that AutoMod treats shorteners as evasion signals in most large subs.

14. **If the founder's product domain is <30 days old** (new TLD, fresh registration), warn that domain reputation will be low and AutoMod filtering elevated for the first few weeks. Recommend driving first traffic from X/email and waiting on Reddit launches until the domain has some inbound link history.

15. **If a Reddit launch post gets removed**, do NOT re-post in the same sub within 7 days, and do NOT post the same content to a sibling sub within 24h. Both are shadowban accelerators. Have the founder DM the mod team asking what rule was violated and wait for response before next move.

16. **If the founder is launching a fun, novelty, single-purpose web tool that works without sign-up**, r/InternetIsBeautiful is the highest-upside sub — Marc Lou's documented 47K visitors in 24h. Title must be "I made a site to [user benefit]." Sign-up walls trigger removal; replace with an email-capture or hide it behind a query param.

17. **If the founder's reply uses the same 3-paragraph template more than 3 times in the same week**, switch to a different framework from the 10-framework list in §4. Mod scan for "same person, same script" detects pattern matching in <10 seconds.

18. **If the founder is about to mention a competitor by name**, don't. Phrase it as "the dominant tool in this space" or describe the category. Naming competitors in promo-adjacent comments reads as combative and gets removed faster in r/SaaS and r/startups.

---

## 9. Failure stories

Five real-world Reddit launch failures, each one a specific lesson.

### Failure 1 — "Banned in 3 days, every single time"

Source: KarmaGuy, citing an unnamed founder.

> "My old strategy was: create account, join relevant subreddits, start commenting with links. Within 3 days, banned. Every single time."

**Lesson:** New-account + immediate-link-comments is the single fastest path to a shadowban. The fix is the 2–4 week warmup (§6).

### Failure 2 — Churnfree.com account banned, negative karma

Source: KarmaGuy.

> "Another founder ran a campaign for Churnfree.com which initially worked well, but their account got banned for violating Reddit's rules, resulting in negative karma."

**Lesson:** Campaigns that look successful early can still trip the threshold. Sustained promotion across multiple subs, even when each individual post is rule-compliant, accumulates risk.

### Failure 3 — Rajdeep Kaur Takhi's first-week ban

Source: [Indie Hackers — Promote Your Startup on Reddit Without Getting Banned](https://www.indiehackers.com/post/promote-your-startup-on-reddit-without-getting-banned-493f7ac5a4).

> "I jumped straight into self-promotion — and got banned immediately."

She rebuilt with a 10-15 day warmup process in a niche sub aligned with her personal interests (cartoons), earning 40–50 karma before any SaaS mention. Her account survived; the lesson she emphasizes:

> "If your SaaS link gets reported, Reddit can blacklist that URL across the entire site. Creating new accounts won't bypass this penalty."

**Lesson:** Reddit doesn't just punish accounts. It can punish *domains*. The blast radius of one bad first week extends to the product itself.

### Failure 4 — Hayden Clay banned from r/Art (artist, Nov 2025)

Source: [RECHO — Reddit Enforces Power Mod Limit](https://recho.co/blog/reddit-enforces-power-mod-limit-brands-win).

Not an indie founder, but the cleanest documented example of mod overreach driving Reddit policy change. An r/Art moderator banned artist Hayden Clay for "self-promotion" (posting his own artwork prints). When users protested, the mod locked the entire 24M-member subreddit and removed all other mods.

> "Reddit admins forcibly unlocked the community and installed new leadership. Previous bans were overturned."

CEO Steve Huffman publicly addressed the incident on Dec 3, 2025; full enforcement of the new 5-subreddit-per-mod limit began **March 31, 2026**.

**Lesson for Maya:** Power-mod era is over. Smaller, more diverse mod teams in 2026 means individual subreddits are easier to read and less likely to apply blanket bans. But the same change means **mod culture varies more by sub now** — don't assume rules from one sub apply to another.

### Failure 5 — IH commenter on Nithin Jawahar's "Hacking Reddit" thread

Source: [Indie Hackers — Hacking Reddit](https://www.indiehackers.com/post/hacking-reddit-how-to-self-promote-without-getting-banned-753396554b).

The author of the "Hacking Reddit" guide had their own account suspended on Reddit, which a commenter pointed out (and the founder disputed). The thread documents the author's experience of "multiple posts get downvoted, took down and flagged for violating community guidelines" before finding a winning formula.

**Lesson:** Even founders writing the playbook get banned while writing the playbook. Reddit is not a forgiving channel. The 20K-views + 100-click result they eventually got was preceded by a graveyard of removed posts.

### Bonus — what success looks like (for contrast)

Worth one paragraph because Maya needs the comparison. Marc Lou's [r/InternetIsBeautiful launch generated 47,000 visitors in 24 hours](https://newsletter.marclou.com/p/how-to-launch-a-startup-on-reddit) from one post. His r/Entrepreneur entrepreneurship-story post generated ~2,000 visitors in 12 hours. Same founder, same week, two subs. The deltas matter:

- r/InternetIsBeautiful is a *traffic* sub (novelty, broad audience, low conversion intent → high pageviews, low signups)
- r/Entrepreneur is a *story* sub (high intent founders, low traffic per post, but conversion-quality readers)

**Lesson for Maya:** "Visitors" and "users" are different KPIs. r/InternetIsBeautiful wins for top-of-funnel awareness. r/SaaS / r/IndieHackers / niche subs win for paying customers. The right launch plan stacks both, but Maya should ask the founder which they need first.

---

## Sources

### §1 — Subreddit landscape

- r/SideProject: [MediaFast — Marketing on r/SideProject](https://www.mediafa.st/marketing-on-rsideproject); [Reddit Growth DB — Best Subreddits for Startups](https://www.redditgrowthdb.com/guides/best-subreddits-startups); [Indie Hackers — What subreddits allow and encourage self-promotion](https://www.indiehackers.com/post/what-subreddits-have-you-found-that-actually-allow-and-encourage-self-promotion-864d4da1cd)
- r/SaaS: [Soar Agency — r/SaaS posting rules decoded](https://www.soar.sh/blog/r-saas-rules-decoded-mod-enforcement); [RedditAgency — r/SaaS Community Guide](https://redditagency.com/subreddits/r/saas)
- r/microsaas: [Reddit Growth DB](https://www.redditgrowthdb.com/guides/best-subreddits-startups) (listed as "r/microstartups, more accepting of promotional content")
- r/Entrepreneur: [Reddit Radar — How to Market on r/Entrepreneur](https://www.reddit-radar-marketing.com/guides/r/entrepreneur); [Reply Agent — Reddit Self-Promotion Rules](https://www.replyagent.ai/blog/reddit-self-promotion-rules-naturally-mention-product); [Reddit Growth DB](https://www.redditgrowthdb.com/guides/best-subreddits-startups) (10-karma min)
- r/startups: [RedditAgency — r/startups Community Guide](https://redditagency.com/subreddits/r/startups); [Reddit Growth DB — monthly Share Your Startup](https://www.redditgrowthdb.com/guides/best-subreddits-startups)
- r/IndieHackers: [RedditAgency — r/indiehackers](https://redditagency.com/subreddits/r/indiehackers); [Reddit Growth DB — SHOW IH flair](https://www.redditgrowthdb.com/guides/best-subreddits-startups)
- r/buildinpublic: [RedditAgency — r/buildinpublic Community Guide](https://redditagency.com/subreddits/r/buildinpublic)
- r/EntrepreneurRideAlong: [mmccaff PlacesToPostYourStartup](https://github.com/mmccaff/PlacesToPostYourStartup/blob/master/README.md); [Baretto tweet on 12 subreddits](https://x.com/_baretto/status/1882083851616567594); [Redplus — r/EntrepreneurRideAlong](https://redplus.ai/en/r/EntrepreneurRideAlong/)
- r/coolgithubprojects: [DEV community comment on r/coolgithubprojects](https://dev.to/tterb/comment/6j79)
- r/programming: [JetThoughts — Self-promote on Reddit without getting banned](https://jetthoughts.com/blog/self-promote-on-reddit-without-getting-banned-promotion/); [Reddit Growth DB](https://www.redditgrowthdb.com/guides/best-subreddits-startups)
- Niche subs: [SingleGrain — Reddit Communities for Your Niche](https://www.singlegrain.com/social-media-management/best-practices/reddit-communities-for-your-niche-finding-the-right-subreddits/); [Refined — How to promote your MVP on Reddit](https://refined.so/blog/marketing-on-reddit); [Reddalyze — SubReddit Analytics for Business](https://www.reddalyze.com/blog/subreddit-analytics-for-business-growth:-how-to-find-your-niche-audience)
- r/InternetIsBeautiful: [Marc Lou — How To Launch a Startup on Reddit](https://newsletter.marclou.com/p/how-to-launch-a-startup-on-reddit)
- r/Notion "banned after 2 posts": [Conbersa — What Are Reddit Self-Promotion Rules?](https://www.conbersa.ai/learn/reddit-self-promotion-rules)

### §2 — The 9:1 doctrine

- [Reply Agent — 90/10 history](https://www.replyagent.ai/blog/reddit-self-promotion-rules-naturally-mention-product) (Reddit retired the rule)
- [KarmaGuy — Reddit Self-Promotion Rules](https://karmaguy.io/en/blog/reddit-self-promotion-rules) ("too rigid, gaming-friendly")
- [Indie Hackers — Hacking Reddit](https://www.indiehackers.com/post/hacking-reddit-how-to-self-promote-without-getting-banned-753396554b) (founder comments)
- [Online Moderation — Market on Reddit without getting banned](https://www.onlinemoderation.com/market-on-reddit-without-getting-banned/) (90/10 still in spirit)

### §3 — Post anatomy

- Title templates: [GrowthExe — Reddit Post Templates That Actually Go Viral](https://growthexe.substack.com/p/55-reddit-post-templates-to-get-clients)
- Body structure: [RedShip — How to launch a product on Reddit](https://redship.io/learn/how-to-launch-product-on-reddit)
- URL placement: [Bitly — How to Post on Reddit](https://bitly.com/blog/how-to-post-on-reddit/); [RedditAgency r/SaaS](https://redditagency.com/subreddits/r/saas)
- Karma thresholds by sub size: [Upvote.net — Reddit AutoModerator](https://upvote.net/blog/reddit-automoderator)
- Real launch URLs (Popsy curation): [Popsy — 3 ways to promote your product on Reddit without getting banned](https://popsy.ai/blog/3-ways-to-promote-your-product-on-reddit-without-getting-banned-(with-examples))
  - [r/SaaS — "I quit my job to focus full time on SaaS"](https://www.reddit.com/r/SaaS/comments/1hn9d64/i_quit_my_job_to_focus_full_time_on_saas/)
  - [r/SaaS — "I raised $2.5M ten years ago"](https://www.reddit.com/r/SaaS/comments/1ljtkzt/i_raised_25m_ten_years_ago_heres_what_i_learned/)
  - [r/SaaS — "Got my first paying user today"](https://www.reddit.com/r/SaaS/comments/1l4l04i/it_finally_happened_got_my_first_paying_user_today/)
  - [r/SaaS — "$5K with my SaaS in 8 weeks"](https://www.reddit.com/r/SaaS/comments/1l0r68d/just_hit_5k_with_my_saas_in_8_weeks_what_worked/)
  - [r/SaaS — "I analyzed 10K top posts"](https://www.reddit.com/r/SaaS/comments/1ljh5ia/i_analyzed_10k_top_posts_on_rsaas_5_post_types/)

### §4 — Reply-mining playbook

- [Indie Hackers — My playbook for using a Reddit lead generation tool](https://www.indiehackers.com/post/my-playbook-for-using-a-reddit-lead-generation-tool-to-find-high-intent-buyers-43b42994cc) (3-paragraph reply framework)
- [Indie Hackers — I built a tool that finds your first customers](https://www.indiehackers.com/post/i-built-a-tool-that-finds-your-first-customers-by-searching-reddit-threads-with-real-buying-intent-playbook-e54c60036b) (evaluation language taxonomy)
- [CatchIntent — Reddit Social Listening](https://catchintent.com/platforms/reddit/)
- [Mean.ceo — 10 Reddit Comment Strategies](https://blog.mean.ceo/startup-news-reddit-comment-strategies-epic-engagement-2026/) (10 reply frameworks + "if deleting it removes the whole purpose" principle)

### §5 — Subreddit rules table

- [Reddit Growth DB — Best Subreddits for Startups](https://www.redditgrowthdb.com/guides/best-subreddits-startups)
- [Soar Agency — r/SaaS posting rules decoded](https://www.soar.sh/blog/r-saas-rules-decoded-mod-enforcement) (60-day rule)
- [RedditAgency — r/SaaS](https://redditagency.com/subreddits/r/saas), [r/startups](https://redditagency.com/subreddits/r/startups), [r/Entrepreneur](https://www.reddit-radar-marketing.com/guides/r/entrepreneur), [r/indiehackers](https://redditagency.com/subreddits/r/indiehackers), [r/buildinpublic](https://redditagency.com/subreddits/r/buildinpublic)
- [MediaFast r/SideProject](https://www.mediafa.st/marketing-on-rsideproject)
- [Upvote.net AutoModerator](https://upvote.net/blog/reddit-automoderator) (karma-by-sub-size thresholds)
- [Reply Agent](https://www.replyagent.ai/blog/reddit-self-promotion-rules-naturally-mention-product) (designated threads)

### §6 — Anti-spam / shadow-ban triggers

- [Multilogin — How to Check if Your Reddit Account Is Shadowbanned in 2026](https://multilogin.com/blog/is-your-reddit-account-shadowbanned/)
- [KarmaGuy — Reddit Self-Promotion Rules](https://karmaguy.io/en/blog/reddit-self-promotion-rules) (Reddit Transparency Report 96.4% auto-detect)
- [Upvote.net — Reddit AutoModerator](https://upvote.net/blog/reddit-automoderator) (domain blacklist, karma gating)
- [Indie Hackers — Takhi: Promote Your Startup on Reddit Without Getting Banned](https://www.indiehackers.com/post/promote-your-startup-on-reddit-without-getting-banned-493f7ac5a4) (domain blacklist quote)
- [Soar Agency — r/SaaS](https://www.soar.sh/blog/r-saas-rules-decoded-mod-enforcement) (URL blacklisting in AutoMod)

### §7 — Show HN equivalent

- [Hacker News — Show HN: I built a fair alternative to Product Hunt](https://news.ycombinator.com/item?id=42712666)
- [ScrollLaunch — 17 Best Product Hunt Alternatives in 2026](https://www.scrolllaunch.com/blog/product-hunt-alternatives-2026)
- [Smol Launch — 13 Best Product Hunt Alternatives in 2026](https://smollaunch.com/alternatives/product-hunt)
- [RedditAgency r/SaaS — weekly feedback thread](https://redditagency.com/subreddits/r/saas)
- [Reddit Growth DB — r/startups monthly Share Your Startup, r/IndieHackers SHOW IH](https://www.redditgrowthdb.com/guides/best-subreddits-startups)

### §8 — Decision rules

- Synthesized from §§1–7 sources above. No new external sources.

### §9 — Failure stories

- [KarmaGuy — Reddit Self-Promotion Rules](https://karmaguy.io/en/blog/reddit-self-promotion-rules) (failure 1, 2)
- [Indie Hackers — Takhi: Promote Your Startup on Reddit](https://www.indiehackers.com/post/promote-your-startup-on-reddit-without-getting-banned-493f7ac5a4) (failure 3)
- [RECHO — Reddit Enforces Power Mod Limit](https://recho.co/blog/reddit-enforces-power-mod-limit-brands-win) (failure 4 — Hayden Clay r/Art)
- [Indie Hackers — Hacking Reddit](https://www.indiehackers.com/post/hacking-reddit-how-to-self-promote-without-getting-banned-753396554b) (failure 5)
- [Marc Lou — How To Launch a Startup on Reddit](https://newsletter.marclou.com/p/how-to-launch-a-startup-on-reddit) (success contrast: 47K visitors in 24h)

### Caveats on sourcing

Reddit's own help docs and rule pages (`reddit.com/r/<sub>/about/rules`, `reddithelp.com`, `redditinc.com`) are not WebFetch-accessible. Every Reddit rule cited above is via a third-party source (RedditAgency, Reddit Growth DB, Soar Agency, MediaFast, KarmaGuy, etc.) summarizing the live sidebars. Maya should treat third-party rule summaries as **best-effort and dated**. When the founder is about to post, the canonical source is the subreddit's live sidebar — Maya should remind them to check it.

Items flagged `(unverified, common wisdom)` in the body are derived from cross-source consensus but not anchored to a single quotable URL.
