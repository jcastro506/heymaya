---
name: maya-calendar-populator
description: After deep-research subagents land target threads + accounts + drafts, generate the rolling 7-day plan (today through Sunday) of calendar events on Google Calendar (provisional, status="draft") mapped to the operator's current phase of the PLAYBOOK 4-phase arc. Each event links to a target thread + draft + cites the playbook rule. Not a 14-day dump — a tight rolling week, regenerated weekly.
---

# maya-calendar-populator

## Purpose

The deep-research subagents (reddit_research, x_research, etc.) surface specific target threads + accounts + drafts. This skill turns those raw artifacts into a real **calendar** — the rolling next 7 days (today→Sunday) of scheduled, time-blocked work the operator can actually do, regenerated each week (NOT a 14-day dump). Each event has a title, what-to-do, link to the target thread/draft, success metric, why-it-matters citation.

Without this skill, the target list lives in the database and nobody acts on it. With it, the operator opens Google Calendar and sees their week.

## When to invoke

- IF deep-research subagents have just completed AND `get_my_target_threads({})` returned >0 rows THEN run. This is the canonical first invocation, right at the end of FIRST WAKE.
- IF weekly review (`gtm_weekly_review` cron) ran AND new target threads were surfaced THEN regenerate the rolling next 7 days (today→Sunday).
- IF format-market-fit detected (Phase 4 cadence change) THEN re-balance the cadence (more metric posts, fewer build updates, etc.).
- IF operator approves a draft via Telegram THEN that drafted_content's calendar event flips from `draft` → `scheduled` (and gets pushed to Google Calendar via Sprint 9).

## Required reads

1. **PLAYBOOK.md § 2** — The 4-Phase Launch Sequence (Phase 1 cold-start / Phase 2 soft launch / Phase 3 hard launch / Phase 4 compound). Determines the SHAPE of the rolling 7-day plan.
2. **PLAYBOOK.md § 4** — BUILD / ENGAGE / OFFER triad ratios. Determines the MIX of event kinds per platform.
3. **APP.md + USER.md** — product context, week goal, operator constraints (canPostTikTokManually, canShowFace, etc.).
4. **GTM.md** — active channel picks. Only generates calendar events for primary + secondary channels.
5. **Per-platform playbook**: `playbook/reddit.md`, `playbook/x.md`, etc. for time-window + frequency rules per channel.
6. **Target list** via `get_my_target_threads({})` — the raw material. Top 30 by priorityScore.
7. **Optionally** `get_my_target_accounts({})` for follow-and-engage events.

## Decision rules

### 1. Where is this founder, really? (judgment, not a lookup table)

I read the founder's actual situation and decide which launch phase fits — this is my judgment grounded in the research, NOT an if-this-then-that table. The signals I weigh: APP.md `stage`, their week-goal, account age, and — most importantly — **what my research agents actually found about their existing presence** (do they have an audience? traction? users already? or are they cold?). A founder "in live-beta" with 500 engaged followers is in a different place than one "in live-beta" who launched their account yesterday. I judge the real picture, not a field.

The launch research (PLAYBOOK § 2) describes four phases — use them as a map of what tends to work at each stage, and pick where this founder is:
- **Cold-start (no audience yet):** the research is emphatic — earn authority FIRST. Heavy daily reply-mining (4-5x more leveraged than posting at cold start), post sparingly, do NOT pitch the product yet. Track velocity (engagement-to-follower ratio), not raw count.
- **Soft launch (has some presence, product is real):** announce it exists in their normal voice, the 5-piece kit, measure what format gets shared — still not a hard "sign up" ask.
- **Hard launch (warmed audience, ready to convert):** the coordinated push — anchor post, first-50 DMs, social proof staging.
- **Compounding (post-launch, has traction/users):** sustained cadence, double down on what's converting, format-market-fit.

A founder with 100 users who's already launched does NOT need the cold-start authority-building arc — push their product. A pre-launch founder with no audience does. **I read the context and choose; I never run a stage→phase rule.** The audience-floor judgment (is there enough presence to launch, or do we keep building?) is mine too — grounded in § 2's "minimum viable audience is about engagement ratio, not follower count."

### 2. Per-platform cadence — research REFERENCE to reason from (2026), not a script

**These are research-backed reference numbers — what tends to work per platform — NOT quotas I fill mechanically.** I reason from them and adapt to the founder's stage + what my agents found. The numbers below (and the "typical cadence" lines per platform) are the evidence base; the actual plan is my judgment over it.

**THE FLOOR (verified deep-research 2026 — this is the non-negotiable shape, the mix flexes by stage):**
- **The motion is reply-driven + active DAILY.** On X, a reply the author engages back on ≈ **75x a like**, a direct reply ≈27x — replies are the single most-weighted signal. Original posts are LOW-volume/HIGH-quality; replies are the engine. "Any posting beats no posting" (Buffer 52M-post study: 10+ posts/wk → +32 followers/wk vs silent weeks).
- **A real plan keeps the founder doing ~15-20 SUBSTANTIVE replies/comments per DAY + ~1 quality post/day (active stage).** Never "3 things a day" — that builds nothing. Never "1 post/week" except Reddit's warm-up window.
- **SUBSTANTIVE is the hard quality bar, not raw volume.** Low-effort "Cool!"/emoji replies are a *documented mistake* — they get deboosted, and >50/day risks spam detection. The "1,000 replies/day" growth-guru pattern inflates vanity metrics and doesn't build an audience. Every reply must add real value. Quality gates volume: ~15-20 *good* replies beats 50 lazy ones.
- **Cold-start (no audience) must EARN it** (Paul Graham, "do things that don't scale"): the founder recruits users one by one, engages first, builds trust — NOT post-and-wait, NOT product-push. Established accounts can coast on social capital a near-zero account doesn't have yet, so a small account's replies must carry substance to convert strangers.
Sources: [X algorithm/replies](https://github.com/twitter/the-algorithm), [Buffer engagement 2026](https://buffer.com/resources/state-of-social-media-engagement-2026/), [Buffer LinkedIn](https://buffer.com/resources/how-often-to-post-on-linkedin/), [YC/PG do-things-that-don't-scale](https://paulgraham.com/ds.html), [indie-hacker X strategy](https://www.teract.ai/resources/twitter-strategy-indie-hackers-2026).

The durable PRINCIPLE: engagement-heavy, active daily, substantive every time, posts kept high-quality. A near-empty week contradicts the research and won't build an audience; a padded week of lazy filler is just as wrong. I hit the daily reps the research supports for their stage, every one of them worth the founder's tap.

**Reddit** ([source](https://www.teract.ai/resources/reddit-subreddit-marketing-2026), [source](https://getupvotes.com/reddit-self-promotion/)):
- 9:1 ratio (Reddit's actual published rule — 1 promotional post per 9 non-promotional contributions). Active marketers tilt toward 95:5.
- Karma floor: 100 (unlocks ~80% of subs), 500 ideal (~90%). If operator under 100, all events default to engagement_block + comment-reply only.
- Frequency: at least 7-14 days between promotional posts in the same subreddit. Newer accounts wait 2-3 weeks.
- Post-time windows: Tue/Wed/Thu 8-11am ET. Mandatory 2-hour engagement window block immediately after any post.
- Designated promo threads: r/Entrepreneur Monday, r/SaaS Saturday, r/SideProject daily, r/IMadeThis daily.
- **Verified-2026: a near-zero Reddit account does ZERO promotional activity for the first ~30 days** — instead **5-10 substantive comments/day** on rising posts in target subs, building to ~100+ karma BEFORE any product mention. This warm-up is mandatory at cold-start; skipping it gets the account flagged/shadowbanned and burns the channel.
- Active cadence (once warmed, ~100+ karma): **5-7 substantive comment-reply events/day** in target subs + **1 original post** (in r/SideProject or the bet sub, respecting the 9:1 promo ratio + 7-14 day gap per sub).

**Hacker News** ([source](https://www.myriade.ai/blogs/when-is-it-the-best-time-to-post-on-show-hn), [source](https://syften.com/blog/hacker-news-marketing/)):
- Show HN: ONE per project, one-shot. Best windows Tue/Wed/Thu 14:00-17:00 UTC (7-10am PT / 10am-1pm ET); contrarian: Sun midnight PT (lower competition).
- Breakout threshold: 30+ votes. Below = invisible to most.
- Comments any weekday — engaging on others' Show HN / Ask HN threads is high-leverage. Aim for substantive (no plug) comments where your expertise applies. (Deep-research couldn't pin an exact HN daily-comment number — treat HN cadence as judgment: substantive comments wherever the founder's expertise genuinely applies, quality over a target count.)
- 72h post-launch window is critical: reply to every comment, every upvote.
- Phase 2 weekly cadence: **4-6 HN comment events** (on relevant Show HN / Ask HN threads in the niche) + (when ModelHub is ready) **1 Show HN launch** in week 3-4 (NOT week 1).

**X / Twitter** ([source](https://www.tweetarchivist.com/how-often-to-post-on-twitter-2025), [source](https://posteverywhere.ai/blog/how-the-x-twitter-algorithm-works)):
- Optimal frequency: **3-5 posts per day** for accounts under 5K followers (build-in-public mode). Reply weight is 150x like weight in 2026 algorithm.
- Reply that gets a reply from the author: +75 ranking weight (vs +0.5 for a like).
- "30 minutes after posting are sacred engagement time" — block immediately after each post.
- Best post windows: Tue morning operator-tz 8-10am for build-in-public threads; daily 5pm-7pm for reply-mining other founders' threads.
- Quality > volume — 3-5 high-engagement posts beats 10 low-engagement (low-engagement damages authority score and reduces future reach).
- **Verified-2026 active cadence: ~1 quality post/day + ~15-20 SUBSTANTIVE replies/day** (a useful structure: ~10 to peer founders/voices in the niche + ~5 to potential buyers). This is the daily engine — every reply adds real value (no "Cool!"/emoji filler; >50/day or lazy replies risk deboost + spam detection). Consistency beats bursts ("1x/day consistently > 5x/day sporadically"). Translate to daily calendar events: 1 post-block + a 30-45min reply-mining block holding the day's ~15-20 specific drafted replies (each its own one-tap item).

**LinkedIn** ([source](https://buffer.com/resources/how-often-to-post-on-linkedin/), [source](https://pipelineroad.com/agency/blog/saas-linkedin-marketing)):
- Optimal frequency: **3-5 posts/week**. Diminishing returns past 5 — 5th post gets 60% of 1st's engagement, 7th post 30%.
- Best windows: Tue-Thu 7-8:30am local. Tue/Wed = highest. Friday -20-30% below midweek. Weekends dead for B2B.
- Engagement format: text-only outperforms images on LinkedIn (counterintuitive). Native video performs much better than external video links. PDF carousels = strong dwell time.
- Founder posts about product-development process = 3.4x engagement of third-party industry reports. Employee content = 8x company-page content.
- Hashtags: 3-5 niche. Reply to every comment within first hour.
- Phase 2 weekly cadence: **3 posts** (Tue + Thu + one flex day, founder build-in-public format) + **2-3 comment-engagement slots/week** (15 min, reply on others' posts in niche). Only schedule if LinkedIn is a bet channel.

**TikTok** ([source](https://joinbrands.com/blog/how-often-to-post-on-tiktok/), [source](https://monolit.sh/blog/tiktok-algorithm-how-it-works-for-business-accounts-2026)):
- **Different motion from the text channels.** TikTok/IG are POST-driven (the algorithm pushes content to a cold FYP), NOT reply-driven like X/Reddit/HN — so the "~15-20 replies/day" floor does NOT apply here. The lever is consistent quality posts + comment-replies on your OWN posts. (Note: the deep-research verified X/LinkedIn/Reddit cadence directly; TikTok/IG numbers below are reasoned from platform-norm sources, not the same verification tier — treat as strong guidance, hold loosely.)
- Optimal frequency: **4-6 per WEEK** for business accounts (not per day — that's a consumer-FYP fallacy). Quality compounds faster than volume.
- Save + share weighted higher than like or comment in 2026. Tutorial/checklist/data-backed formats save best.
- Niche consistency: 3+ unrelated topics = -45% reach. Stay focused on one persona.
- Best windows: 7-9am + 6-9pm local audience time.
- Phase 2 weekly cadence: **4 posts/week** ONLY IF `canPostTikTokManually === true` AND `tiktokWarmupState === "ready"`. Otherwise: 0 TikTok events (skip channel; do warmup separately).

**Instagram**:
- Reels for reach. Save rate = primary metric (algorithm weights saves > likes).
- Phase 2 weekly cadence: **2-3 Reels/week** ONLY IF `canPostInstagramManually === true`. Carousels (10-slide educational) for save rate.

### 3. Slot allocation — reference shapes per stage (reason from, don't execute blindly)

**These are reference shapes for what a week tends to look like at each stage — I fit them to the founder, I don't run them as quotas.** The volumes encode the research (cold-start = engagement-heavy/few posts; active launch = denser/multi-channel). I scale to what THIS founder can realistically do and what their buyers' channels support — but I keep them genuinely active daily, because the research says that's what builds an audience. Never a hollow week, never padding.

**Cold-start (no audience yet):**
- Primary channel: 5-7 reply_window + 2-3 engagement_block. **NO posts.**
- Secondary channel: 3-4 reply_window + 1-2 engagement_block.
- Total: ~10-15 events/week. All passive-engagement.

**Phase 2 (active launch — the high-velocity week)** — operator has product, wants signups:
- Primary channel: **per § 2 numbers above for the specific channel.**
- Secondary channel: half of primary.
- Tertiary (X build-in-public ALWAYS, if operator can write): 1 post/day + 4-5 reply-mining/week.
- 1 weekly_review (Sun or Mon, 30 min).
- **Total target: 18-25 events for the week.** Sub-15 = under-prescribed. Over-30 = unrealistic for a solo founder.

**Phase 3 (hard launch)**:
- 1 hard_launch_anchor (Tuesday primary channel) + 2-3 reply_window in the engagement window + 1 first_50_dms (Monday) + 1-2 X threads pre-anchor + 4-5 reply-mining/week.
- Total: ~10-12 events centered on the anchor week.

**Phase 4 (compound)**:
- Primary: 1 metric + 2 build/insight + 1 demo + 4-5 reply_window/week + 1 weekly_review.
- X build-in-public: 1 post/day continues.
- Total: ~12-15 events/week sustained.

### 3a. Channel-tier rule for active-launch mode (Phase 2/3)

For ModelHub-class products (dev tool, niche audience, founder-led):
- **Primary** = whichever channel has highest channelScorecard `audienceFit + cadenceFit` AND operator has voice match for. Typically Reddit for dev tools.
- **Secondary** = next-best. Typically HN for dev tools.
- **Tertiary build-in-public** = **X is the always-included build-in-public channel** UNLESS operator explicitly excluded X. Daily founder cadence happens here regardless of primary/secondary.
- **LinkedIn** = scheduled ONLY if explicitly a bet channel.
- **TikTok / Instagram** = scheduled ONLY if `canPostTikTokManually` / `canPostInstagramManually` true AND warmup ready.

### 4. Event linking

Every event MUST link to its source:
- reply_window events: `targetThreadId` references the gtmTargetThreads row.
- post events (soft_launch_post / hard_launch_anchor): `draftedReplyId` references the gtmDraftedContent row.
- warmup_block: cites the specific playbook section (tiktok.md § 6 / reddit.md § 6).
- engagement_block: cites the priority subreddit/community to lurk in (from gtmTargetSubreddits or per-channel playbook).

### 5. Status semantics

All events default to `status: "draft"`. They are visible to the operator but NOT yet on Google Calendar. The operator reviews via Telegram or mission board, approves, and only then does the calendar-write happen (Sprint 9 path) flipping to `status: "scheduled"`.

### 6. Voice contract (per SOUL.md)

Every event title + description is operator-facing. Apply the voice contract:
- **Allowed**: "Reply on r/LocalLLaMA hardware war thread" / "Scroll niche FYP for 20 min" / "Post your launch thread Tuesday morning"
- **BANNED**: "warmup_block event" / "priorityScore 0.87 target" / "reply_window from maya-reddit-demand-researcher" / "draftedReplyId 89234..." — these all leak internals to the operator.

The title is what the operator sees in their calendar app. Make it sound like a teammate's note, not a database row.

### 7. Holiday + industry-event check (PLAYBOOK § 2.3.1)

Maya checks before slotting hard_launch_anchor or soft_launch_post events. Skip US holidays, known industry events (re:Invent, WWDC, etc. if relevant to the niche), Black Friday week, end-of-year freeze.

### 8. Account warmup gating

If primary channel has unmet Phase-1 audience minimum (PLAYBOOK § 2):
- ALL post-kind events get pushed to Phase 1 schedule (no posts until warmup done)
- the rolling 7-day calendar is exclusively warmup_block + engagement_block + reply_window (replies allowed during warmup if they're substantive, not promotional) — the warmup PERIOD still runs its full 2-4 weeks; we just plan it a rolling week at a time
- Maya signals to user: "We're in warmup. No public product mentions yet. Tomorrow's first task is X."

### 8b. Hard-launch / Show HN preconditions (HARD GATE — kills the 48h-cold-launch bug)

**NEVER emit a `hard_launch_anchor` or a Show HN event until ALL THREE preconditions pass.** A cold launch into a tiny audience is a guaranteed void (PLAYBOOK rule 9.8) — it burns the one-shot launch moment. Before slotting either:

1. **Account maturity** — `creator.createdAt` is old enough that the account isn't brand-new, AND warmup is done (TikTok `tiktokWarmupState === "ready"` for TikTok; for Reddit/HN/X/LI the account has real history, not days-old). A <48h-old account launching this week → NO. Tell the operator: "your accounts need to warm up first — here's this week's warm-up plan; we launch once you've got a baseline."
2. **Audience floor** — the primary channel's Phase-1 audience minimum (PLAYBOOK § 2) is MET. No floor → stay in warmup, don't launch into the void.
3. **Days-in-phase** — the operator has actually spent the soft-launch (Phase 2) time building credibility; we don't skip Phase 2. (Manager-mode founders with an existing warmed audience can clear 1+2 immediately — judgment, not a fixed timer.)

If any precondition fails, do NOT slot the launch; slot the warm-up/soft-launch work that earns it, and say so plainly. **This gate is also re-checked at publish time** (`publishApprovedDraft`) — a launch draft that reaches publish without preconditions met is blocked, not posted.

### 8c. The launch bundle (one approval-gated unit, never a lone post)

A hard launch ships as ONE coordinated, approval-gated bundle — not a single anchor post:
- **5-piece launch kit** — the anchor post + the supporting assets (e.g. the demo/proof artifact, the first-comment context, the cross-post variants, the reply-ready FAQ). Drafted together.
- **first_50_dms** — the warm-outreach block the day before, so the launch doesn't drop into silence.
- **staggered multi-channel** — the anchor + the same-day cross-posts/threads, time-staggered, as one unit.

Maya proposes the whole bundle for approval (per the strategy approval gate); the operator approves once, and it executes as a unit. Launches are **proposed + approved, never auto-scheduled**.

### 8d. 72-hour post-launch engagement window (auto-seed + auto-diagnose)

When a `hard_launch_anchor` is published, auto-seed the **72h engagement window**: reply_window + engagement_block events across the next 72h so the operator stays in the thread (the #1 launch-failure cause is post-and-pray, PLAYBOOK rule 9.29). At T+24h, check engagement: if it's **<1%** (a void by rule 9.8 — reached only the founder circle), do NOT recommend doubling down with paid promotion. Auto-flag a **reposition/replan**: the format or positioning is wrong, not the distribution — retry with a different angle in ~14 days (hand to maya-results-reviewer's positioning-vs-distribution diagnosis).

## Output

Call `propose_calendar` per the TOOLS.md spec (one call carries the events array; don't pass an idempotency key — it's auto-minted). Convex stores them as `draft` — it does NOT compose, lay out, or time-slot them. **All of that is your job here.** Shape:

```ts
propose_calendar({
  researchJobId,                     // current job
  events: [{
    title,                           // operator-facing, voice-contract clean
    description,                     // the FULL hands-off recipe — see below
    startsAtMs,
    endsAtMs,
    kind: "warmup_block" | "engagement_block" | "reply_window" | "soft_launch_post" | "hard_launch_anchor" | "first_50_dms" | "weekly_review",
  }],
})
```

### The description IS a hands-off recipe (the operator has a day job)

Every event `description` must be a complete recipe the operator can act on without thinking or asking a follow-up. For a reply_window built from a target thread, pull the thread's `draftReply` (already composed + on the row) and its one-tap deep link (the thread row carries it — see TOOLS.md "Deep links / intent URLs"):

```
WHAT: <one-line action — "Reply to this r/LocalLLaMA thread">
LINK: <thread URL>
OPEN (one-tap): <the thread's deep link / intent URL — pre-filled composer on X/Reddit-submit/LinkedIn; the thread URL to paste into on Reddit-comment>
WHY: <one sentence — why this thread, why now (cite the pain/velocity)>
YOUR REPLY (verbatim — copy/paste/edit/post):
<the draftReply already on the thread row>
VOICE NOTES: <one sentence — what to tweak if you want>
AFTER YOU POST: <reply to me — I'll track results 72h>
SUCCESS TARGET: <e.g. 1 OP reply or 5+ upvotes within 4 hours>
TIME: <minutes — usually 10-15>
```

For events with NO thread target (X build-in-public post, engagement_block, warmup_block), the recipe still carries WHAT / WHY / a starter draft or prompt / SUCCESS TARGET / TIME — never a bare title. A reply_window with no `draftReply` and no link is not actionable — don't emit it; fix the thread or drop it.

Default durations:
- reply_window: 20-30 min
- engagement_block: 30-60 min
- warmup_block: 20-30 min
- soft_launch_post: 30 min (post + immediate engagement)
- hard_launch_anchor: 2 hours (post + engagement window)
- first_50_dms: 60-90 min
- weekly_review: 30 min

## Failure modes

- **No target threads landed.** This skill is no-op. Surface to user: "Deep research found nothing usable — need to widen the search OR pick a different channel." Push retry to next research cycle.
- **Calendar OAuth not connected.** Events still get drafted (status:draft). Tell user to connect Google Calendar via onboarding so the scheduled events show up there too. The Telegram nudge cron still works without Google Calendar.
- **Phase 1 floor unmet on ALL channels.** Pure warmup mode — the rolling 7-day plan is all warmup. Maya is explicit that the warmup PERIOD runs longer: "Your accounts need 2-4 weeks of warmup before launch. Here's this week's plan."
- **Operator overrides Phase 1 + insists on launching.** Document the override per AGENTS.md operating contract rule 1. Schedule the launch event anyway with a warning in the description: "Operator override — launching despite Phase 1 floor not met. Recover path: if engagement <1%, repositioning required."

## Cost discipline

0 ScrapeCreators. 0 paid external APIs. Pure synthesis of existing target list + playbook rules into calendar events. 1-2 main_maya LLM calls (no thinking budget needed; this is structured-output work). Timeout 5 min.

## Anti-slop check

Run maya-slop-critic on every event `title` and `description`. Banned phrases (PLAYBOOK § 6). Event titles must be operator-natural — not "engagement_block #4" or "Reply 1/15".
