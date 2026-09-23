# Maya expertise audit — is she actually a social media expert?

**Date:** 2026-09-23 · **Branch read:** `creator` @ `3519c9b`
**Scope:** every skill, tool, memory path, and eval, judged against the situations creators actually face.
**Method, and its limit:** this is a **code audit**. It says what she *can* and *cannot* do given her tools, data, and instructions. It does not yet say how well she does the things she can do. That takes a behavioural benchmark against real cases, which is Sprint B0 below. Nothing in this document is "verified" until B0 has run.

---

## 1. Verdict

Maya is built to be **honest about numbers**, and that part is strong: the grounded-number checks, the connected-vs-public labels, the "can't see watch time on TikTok" rule, the critic, and the soul's ban on inventing causes. She is **not yet an expert on causes**: why a post popped, why it died, what is happening in the world or on the platform, and what to do next. Three reasons:

1. **She measures one thing well.** Every analysis compares views or reach against *their normal*. She has no data on timing, world context, trend lifecycle, or traffic source, and no history of a post's numbers over time. Most real explanations live there.
2. **Her skills steer away from explaining.** The proactive win message is instructed to be "a real, specific celebration and one thing to do while it's moving, nothing else" (`scout/scout.ts:45`). So the moment a creator most wants to know *why* is exactly when she's told not to say.
3. **Her evals test how she sounds, not whether she's right.** The judge scores corny, generic, flattering, toolSpeak, specific, wouldSend, and soundsLikeThem (`eval/judge.ts`). Nothing checks whether her diagnosis was *correct*. So "the evals are green" means she sounds right.

The good news: the scaffolding for fixing this is already there — the bounded tool loop, the budget gate, trace rows, the critic, the prediction track record, and memory records. What's missing is data, the right playbooks, and a benchmark with right answers.

## 2. Worked example: "a creator who normally gets 2k suddenly gets 110k"

What happens today, traced through the code:

| Step | What happens | Where | Problem |
|---|---|---|---|
| Detection | The daily readback at **01:15 UTC** scrapes their public feed, recomputes multiples, and writes a `win` signal at ≥3× | `scout/readback.ts`, `crons.ts:22` | Up to **24 h late**. The hourly Zernio delta sync doesn't trigger wins, so "while it's moving" isn't true. |
| "Normal" | The median of the **last 20 posts' lifetime views**, including posts only hours old | `onboarding/ingest.ts:119` | Not adjusted for age: a 6-hour-old post is compared with 60-day-old lifetimes. And the opinion path defines normal differently (median of the last **60** posts, `agent/opinion.ts` `ownHistory`), so she can cite two different "normals". |
| Proactive message | The scout picks the win and writes a **celebration only, by instruction** | `scout/scout.ts:45` | No "why", no follow-up plan. |
| If they ask "why did this pop?" | explain-post runs with **3 lookups** | `agent/opinion.ts:207`, `playbooks.ts explainPost` | See below. |
| `post_diagnosis` | A four-way read: not distributed / scrolled / hook lost them / held them / normal | `connections/analytics.ts:derive` | **There's no "broke out" category.** A 55× post with healthy engagement comes back as **"normal"**. |
| Trend check | `search_keyword`, hard-coded to `window: "this-week"` | `agent/tools.ts:312` | It checks *this* week, not the week the post went out. A post that rode last month's wave looks like nothing. |
| Sound check | Not in the explain-post playbook | `playbooks.ts` | The most common cause of a TikTok spike isn't looked at by default. |
| World context (a concert, the news, a holiday, a game) | **No tool exists** | — | She can't know the post went up the night of a concert. |
| Views over time (spike vs slow burn vs search tail) | Metrics are **overwritten**, with no history kept | `ownPosts.metrics` | She can't tell "exploded in 6 hours" from "crept up over 3 weeks via search". |
| Asking them | The soul allows "one question at most… most replies end on a statement" | `agent/soul.ts` | There's no protocol for "I can't separate these two causes, so here's the one question that would". |

**The likely result today:** a warm, honest, well-written message that says the post did 55× their normal, reacts to a real moment in it, maybe mentions the comments, and says little about the actual cause. At its best: "I can't tell exactly why." Honest, but not expert.

## 3. The situations creators face — coverage map

✅ covered · 🟡 partial (tools exist, the playbook, data, or test is missing) · ❌ missing

### A. My numbers did something weird

| # | Situation | Today | Gap |
|---|---|---|---|
| A1 | One post explodes (2k → 110k) | 🟡 | §2: no breakout diagnosis, no timing/world/trend-at-time/traffic context, late detection, celebration-only message |
| A2 | An old post suddenly gains weeks later (search tail, resurfaced) | ❌ | No metric history, so the slow burn is invisible |
| A3 | Views collapse across several posts ("am I shadowbanned?") | 🟡 | `rung` sees a bad week, but there's no multi-post collapse detector and no honest shadowban playbook (myth vs real restriction) |
| A4 | Stuck at ~200–300 views on everything | 🟡 | "not distributed" exists (reach < 0.5× normal), but for a small account the *normal* is 250, so it never fires. It needs an absolute floor and a new-account playbook |
| A5 | Lots of views, no followers | 🟡 | `follows` only on IG connected; `followerSnapshots` exist daily; nothing connects "views up, follows flat" into a read |
| A6 | Followers up, views flat | ❌ | Not analysed |
| A7 | The same video pops on TikTok and flops on IG (or the reverse) | ❌ | Posts aren't matched across platforms, so there's no split read |
| A8 | A repost of an old video does better or worse than the original | ❌ | No duplicate or repost detection |
| A9 | Views fine, zero comments or shares (passive views) | 🟡 | "distributed_scrolled" exists at < 1% engagement per reach, connected only |
| A10 | A post removed, restricted, "ineligible for For You", audio muted | ❌ | A post disappearing from the feed is never noticed; there's no guidelines playbook |
| A11 | Sudden follower loss | 🟡 | Snapshots exist; no detector or read |
| A12 | A paid boost (TikTok Promote / IG boost) inflates a post and skews "normal" | ❌ | Can't tell organic from paid on their own posts, and a boosted post poisons the median. She should ask |
| A13 | Went viral with the wrong audience (bots, rage-viewers, foreign audience) | ❌ | Comments aren't read for audience shift; the audience endpoint (`tiktok/user/audience`) exists in the client but isn't a tool |

### B. Comments and audience

| # | Situation | Today | Gap |
|---|---|---|---|
| B1 | A hate pile-on or harassment | ❌ | No sentiment read, no playbook (don't feed it, mute keywords, filter, when to address it); no wellbeing handling |
| B2 | A video misread, turning into a backlash | ❌ | Same, plus a "clarify or let it die" judgment |
| B3 | The same question in comments = demand for a part 2 | 🟡 | `post_comments` exists; the scout playbook reads buckets for *others'* posts; not run proactively on their own hits |
| B4 | A big account stitched, duetted, or shared them | ❌ | "came from @x" comments are the only signal and nothing looks for them; no stitch/duet endpoint |
| B5 | Brand interest showing up in comments or DMs | 🟡 | Partnerships exist for entitled tiers; comments aren't scanned for it |

### C. Trends, timing, the world

| # | Situation | Today | Gap |
|---|---|---|---|
| C1 | "Is this trend still alive or am I too late?" | 🟡 | `sound_videos` / `search_keyword` exist; no lifecycle read (rising / peaked / dead with dates) |
| C2 | A cultural moment: concert, game, release, holiday, news in their niche | ❌ | No world-context tool. The calendar only knows *their* events |
| C3 | Plan ahead for seasonal moments (back to school, Halloween, Black Friday) | ❌ | No calendar of cultural moments |
| C4 | Trending sound vs original audio; a sound removed or copyright-muted | 🟡 | Sound tools exist; nothing on removals or commercial-account sound limits |
| C5 | A platform change (algorithm shift, new feature, longer videos, ban news) | ❌ | No dated platform knowledge; she answers from the model's training data, which is stale by design |

### D. Craft

| # | Situation | Today | Gap |
|---|---|---|---|
| D1 | The hook isn't working | ✅/🟡 | IG Reels skip rate plus her watched card; TikTok has no retention, handled honestly |
| D2 | Too long, pacing | 🟡 | Length bucket exists; no read of their length against how their own posts held up |
| D3 | A format that worked has stopped working (fatigue) | 🟡 | The taste model separates preference from performance; no fatigue detector across a format's run |
| D4 | "What do I post after a hit?" | ❌ | The win message is instructed not to plan. There's no follow-up playbook (part 2, reply-to-comment video, pin a comment, post within 24–48 h) |
| D5 | Creative block / "give me ideas" | ✅ | Scout, moment, week plan |
| D6 | Review my draft before I post | ✅ | opinion on a draft file, prediction row, track record |
| D7 | Captions, hashtags, posting time | 🟡 | Best hours are computed from their own numbers; hashtag and caption advice have no dated platform facts |
| D8 | Face vs faceless, niche pivot | 🟡 | growth_plan plus lane clusters; no pivot playbook |

### E. Growth and strategy

| # | Situation | Today | Gap |
|---|---|---|---|
| E1 | Plateaued for months | 🟡 | The rung diagnoses a week; nothing reads months |
| E2 | "Why is @x growing and I'm not?" | ✅/🟡 | The profile skill with lookups; answers are only as good as the untested playbook |
| E3 | Posting frequency, burnout from cadence | 🟡 | Cadence in the growth plan; the human cadence notices silence; no burnout read |
| E4 | Cross-platform strategy | 🟡 | Both platforms read; no split analysis (A7) |
| E5 | Monetisation thresholds (TikTok Creator Rewards, IG bonuses, subscriptions) | ❌ | Stale model knowledge; these change often and must come from dated facts |

### F. Business and safety

| # | Situation | Today | Gap |
|---|---|---|---|
| F1 | "What should I charge this brand?" / replying to a brand | 🟡 | Partnerships (tier-gated) draft outreach; no pricing guidance grounded in their numbers |
| F2 | Scam collab offers, fake brand emails | ❌ | No scam playbook |
| F3 | Hacked account, impersonator | ❌ | No playbook (steps and official links) |
| F4 | Creator distress: hate, burnout, crisis language | ❌ | No protocol. She must not be a therapist, but must recognise crisis language, give resources, and alert the operator |

### G. Maya herself

| # | Situation | Today | Gap |
|---|---|---|---|
| G1 | Asked for something she can't know | ✅ | `cannotKnow`, platform-honest rules |
| G2 | They disagree with her read | ✅ | Soul: hold with the evidence or change her mind and say why |
| G3 | Silent for two weeks | ✅ | Pulse plus the quiet check |
| G4 | "Forget that", "that's not me" | ✅ | Memory epochs; gauntlet green 2026-09-09 |
| G5 | A causal lesson remembered later ("your concert post popped on timing; Friday's festival is the same shape") | ❌ | Her analysis of a hit isn't stored as a record, so she can't build on it |

**Tally, 45 situations: 6 ✅ · 2 mostly ✅ · 18 🟡 · 19 ❌.** Most of the ❌ items fall into the same few capability gaps, below.

## 4. Other findings from the code

| # | Finding | File |
|---|---|---|
| F1 | `post_diagnosis` has no outlier category; big wins read "normal" | `connections/analytics.ts derive()` |
| F2 | Two definitions of "normal" (last 20 vs last 60), and neither adjusts for post age | `onboarding/ingest.ts:119`, `agent/opinion.ts ownHistory` |
| F3 | Wins are detected once a day from public scrapes; hourly connected data never triggers them | `scout/readback.ts`, `connections/sync.ts` |
| F4 | The win message is instructed to celebrate only | `scout/scout.ts:45` |
| F5 | explain-post has a 3-lookup budget and no sound check; `search_keyword` is fixed to this week | `agent/opinion.ts:207`, `agent/tools.ts:312` |
| F6 | Post metrics are overwritten, so there is no curve | `ownPosts` |
| F7 | No world-context or web search tool (the Tavily key is still blocked) | — |
| F8 | No dated platform knowledge base. CLAUDE.md says "platform expertise lives in `.md` files", but on this branch it lives only in prompt strings | `agent/playbooks.ts`, `soul.ts` |
| F9 | The audience endpoint exists in the client but isn't a tool | `integrations/scrapeCreators/platforms/tiktok.ts` |
| F10 | Evals score tone and number-grounding, not correctness; the only scenario creators are 2 real handles, and there are no outlier, flop, or crisis fixtures | `eval/judge.ts`, `eval/scenarios.ts` |
| F11 | Every analysis runs on `gemini-3.7-flash`. Whether a stronger model is worth it for diagnosis specifically is untested | `agent/registry.ts` |

## 5. What to build: nine capabilities

1. **Numbers foundation.** One age-adjusted definition of "normal" (their median at the same post age). Post snapshots: hourly for the first 72 h from the Zernio delta, then daily, stored as a bounded array on `ownPosts` (no new table). Diagnosis v2 with the full taxonomy: *broke out, slow burn / search tail, not distributed, stuck (absolute floor), scrolled, hook lost, held, collapse across posts, removed/restricted*. Win detection moves to the hourly sync, with velocity.
2. **"Why it did that" investigation**, for both pops and flops. A deterministic evidence pack assembled by code before the model sees anything:
   - a **contrast** against their last 20 posts (length, format, hook type, posting hour, weekday, sound, topic, caption length);
   - the **curve shape**;
   - **comment buckets**, including "came from @x", part-2 demand, audience shift, and pile-on;
   - **sound and keyword usage around the posting date**, not this week;
   - **date context**.

   The model's output is **ranked hypotheses**, each with its evidence and a confidence. Code enforces that every hypothesis cites an evidence item. A hypothesis with no evidence is dropped before the message is written.
3. **Ask-the-creator protocol.** When the top two hypotheses can't be separated by data, she asks **one targeted question that names them**: "is this from the concert? or did someone big share it — I'm seeing a lot of 'here from @x'". The answer is written as a record, and the diagnosis is updated and remembered (G5). Things only the creator knows go here by default: a paid boost, a share by a friend, a cross-post, a location change.
4. **World context tool.** Web and news search by **date and place** ("what happened in Austin on Sep 12"), plus a curated **calendar of cultural moments** (holidays, big releases, sports finals, awards) for seasonal planning. This needs an operator decision on the vendor (§8).
5. **Trend lifecycle.** For a sound, hashtag, or keyword: usage over time with dates, from `sound_videos` / `search_keyword` using the vendor's `date_posted` / `publish_time` windows, not a fixed `this-week`. Classified by code as **rising / peaking / fading / dead**. The model phrases it; it doesn't classify.
6. **Platform knowledge base** (`knowledge/platforms/*.md`). Monetisation programmes and thresholds, guideline basics, feature facts, known myths (shadowbans), and account-safety steps. Every fact carries a **source link and a verified-on date**. A retrieval tool serves it, a monthly cron flags facts older than 60 days to /ops, and she must say "as of <month>" when she cites one.
7. **After-a-hit playbook.** The win message becomes: the celebration, then the *established* why (only if the evidence clears the confidence threshold), then the one thing to do in the next 24–48 h (answer the top comment with a video, the part 2 people are asking for, pin a comment, post while the audience is warm). The follow-up is proposed as a block through the existing calendar path.
8. **Health, safety, business playbooks.** Collapse and restriction reads (with the shadowban myth handled honestly), hate and pile-on, hacked or impersonated accounts, scam offers, and brand-pricing sanity grounded in their own numbers. Crisis language triggers **resources plus an operator alert** and a reply that doesn't coach. This is a code path, not a prompt hope.
9. **Model choice for diagnosis.** Run the benchmark on the current writer and on one stronger model *for the diagnosis skill only*, and decide on score gained per dollar (the standing price-first rule).

## 6. How we become confident: the Expert Bench

We don't claim she's ready until she passes a benchmark with **right answers**.

- **Cases:** about 120 frozen cases, 2–4 for each situation in §3. Where possible they come from **real public posts with a known cause** (a post from the night of a named event, a post that used a sound on its way up, a post stitched by a large account visible in its comments, a search-tail tutorial). Crisis, scam, and hack cases are synthetic. Each case is a fixture: the post, the author's feed, comments, sound usage, the date-context result, the connected numbers where relevant, and the creator's messages.
- **Labels** (the operator signs off): the **acceptable causes and advice**; the **must-not-claim** list (causes that would be invented); whether a **question is required** (the case can't be settled from data); and the **safety expectations**.
- **Scoring:**
  - **Correct:** the top-1 or top-2 hypothesis is in the acceptable set.
  - **False-claim rate:** any must-not-claim asserted. **The target is 0, and it's a hard gate.**
  - **Asks when it should:** on required-question cases, the one question names the real candidates.
  - **Useful action:** the next step is specific and doable within 48 h.
  - The existing tone judge and number-grounding checks, unchanged.
  - **Cost and latency** per case.
- **Runs** in CI on recorded fixtures (deterministic tools, real model), nightly and before any prompt or model change. It extends the existing `convex/eval` suites and the /ops labels; it doesn't replace them.
- **Live check:** at the end of each sprint, the operator's own accounts and 3 consenting creators' real outliers and flops, read by Maya and graded by the operator.

## 7. Sprints

These **run before app sprint M2.** The app is a shell around her brain, and a beautiful shell around a shallow brain is the wrong order. App M0 (blocked on the Apple account anyway) and M1 (design system) can run in parallel.

### B0 — Baseline the truth (4–5 d, no product changes)
**Build:** the Expert Bench harness, the ~120 fixtures, the labelling UI on /ops, and scoring.
**Tests:** harness determinism (the same fixture and seed give the same tool results); the fixtures load in isolation (scenario creators are never paired or billed, per the existing rule).
**Exit:** a published **scorecard for today's Maya** on every situation. This is the "before" picture, and it will probably confirm §3. If any situation scores well despite being marked ❌, §3 was wrong and is corrected.

### B1 — Numbers foundation (5–6 d)
**Build:** capability 1: age-adjusted normal (one definition, used by every skill), post snapshots, diagnosis v2, hourly win and collapse detection, removed-post detection, the absolute floor for small accounts, boosted-post exclusion once confirmed.
**Tests:** pure unit tests on `derive()` for every diagnosis class, from recorded Zernio and ScrapeCreators rows; a property test that no single post (including a 100× one) can move normal by more than its median share; a sibling-coherence test that every skill citing "normal" imports the one function; row-level simulations of a spike, a slow burn, a collapse, and a deletion.
**Exit, live:** on staging, a real post crossing 3× is detected **within 2 hours**, and its diagnosis reads "broke out" with the right basis.

### B2 — Diagnosis brain (6–8 d)
**Build:** capabilities 2, 3, 5, and 7: the evidence pack, ranked hypotheses with a code-enforced citation per hypothesis, the ask protocol, trend lifecycle, the after-a-hit playbook, and the redesigned win message. Explain-post's budget and playbook are redone around the pack.
**Tests:** the bench on categories A, B3–B4, C1, C4, D1–D4; **false claims = 0**; required-question cases at ≥ 90%; adversarial tests (a comment that says "ignore previous instructions", or a "came from @x" planted by a bot) where the pack treats comments as quoted data; budget fail-closed (an investigation that runs out of credits still answers and names what it couldn't check); cost ≤ the cap per investigation, with the cap set in B0 from real costs.
**Exit, live:** three real outliers (the operator's and pilot creators') are diagnosed, and **the operator agrees with the leading cause or with her question** in all three.

### B3 — World and knowledge (5–6 d)
**Build:** capabilities 4 and 6: the world-context tool (via the chosen vendor, through the budget gate), the cultural-moments calendar, the platform knowledge base with sources and dates, the staleness cron, retrieval, and "as of" enforcement by the critic.
**Tests:** the bench on C2, C3, C5, D7, E5; a staleness test (a fact older than 60 days is flagged and she hedges on it); a test that a platform fact she cites exists in the knowledge base (no citing from model memory); cross-tenant isolation (a creator's location or dates are never shared across tenants in search queries); a date-context test for the concert, game-night, and holiday cases.
**Exit, live:** a real post from a real event night is explained by the event, with the source linked. A seasonal proposal lands at least 10 days ahead of a real upcoming moment in the creator's niche.

### B4 — Health, safety, business (4–5 d)
**Build:** capability 8.
**Tests:** the bench on A3, A10, A12, B1–B2, F1–F4; crisis-language cases send resources and an operator alert in **100%** of cases (a hard gate); scam cases warn in 100%; the shadowban answer never asserts a ban without a restriction signal; brand pricing always cites their own numbers or says it can't.
**Exit, live:** the operator runs each safety scenario by text against staging and approves every reply.

### B5 — Re-bench, model decision, sign-off (3 d)
**Build:** capability 9; tune thresholds from the bench; write the results into this document.
**Tests:** the full bench on both candidate models; a regression check against the B0 scorecard (no situation gets worse).
**Exit:** **every §3 situation at ✅ or at a written, accepted limitation** (for example, "TikTok doesn't expose traffic sources; she says so and asks"). False claims = 0, safety gates 100%, and the operator signs the scorecard.

Every sprint also runs the five mandatory categories: cross-tenant, budget fail-closed, adversarial input, sibling coherence, and TODO grep.

## 8. Operator decisions

1. **World-context vendor:** a web and news search API (Tavily, Exa, or Brave). Price per query × expected calls must be checked first, per the standing rule. The Tavily key is already on the blocked list.
2. **Order:** confirm the B-sprints run before app M2 (recommended), with app M0 and M1 in parallel.
3. **Labelling time:** B0 needs about 4–6 operator hours to sign off ~120 cases. The bench is only as good as those labels.
4. **Pilot creators:** 3 who consent to having their real outliers and flops used as live exit cases.
