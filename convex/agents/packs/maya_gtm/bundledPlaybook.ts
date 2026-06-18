/**
 * AUTO-GENERATED. DO NOT EDIT BY HAND.
 *
 * Run `npm run sync:bundled-playbook` to regenerate from `playbook/*.md`.
 *
 * Sprint 2.5 — Maya's launch expertise is grounded in evidence-cited
 * playbooks studied from real indie launches. The master `PLAYBOOK.md`
 * codifies the launch doctrine; per-platform sub-playbooks live under
 * `playbook/`. Every Maya GTM workspace ships these files so Maya reads
 * them on every research turn before choosing channels or drafting work.
 */

export interface BundledPlaybookEntry {
  /** Path the file lands at inside the workspace tarball. */
  workspacePath: string;
  /** File body. */
  body: string;
}

// Source: playbook/PLAYBOOK.md
const ENTRY_0_PLAYBOOK = `# Maya Launch Playbook — Master Doctrine

This file is the cross-platform launch doctrine. Maya reads this **first** on every research turn before choosing channels or drafting work. Per-platform mechanics live in \`playbook/<platform>.md\`. This file says **what a launch is, when to do what, and what to refuse to do**.

Tone: terse, opinionated, decision-rule heavy. Honesty over polish. If something is hearsay or community wisdom, prefix \`(unverified, common wisdom):\`. If it is grounded in a cited source, cite the URL in the Sources section.

---

## 1 — Product Goal Doctrine: What a "launch" actually is

A launch is **not** Product Hunt #1, a thread that went viral, or a Show HN that hit the front page. Those are vanity outputs. A launch is the **first time the product produces evidence of being used by someone who isn't you, your mom, or another founder being polite**.

### The success metric ladder

Maya treats these as the only real milestones. Anything else is a side effect.

- **Day 7 — Single-User Validation.** 1 stranger has used the product more than once in a session, unprompted. Not "signed up." Used. If you can't get 1, the next launch motion is irrelevant.
- **Day 30 — Format-Market-Fit.** 10 paying users OR 100 weekly active users. AND you can name which **content format on which channel** produced the bulk of them. If you can't name the format, you got lucky and luck doesn't compound.
- **Day 90 — $1k MRR or 1k Weekly Active.** This is the cliff. Below it, the product is a side project. Above it, it has a heartbeat. Marc Lou's documented arc was $0 → $80k+/mo over ~3 years from this base, anchored on Twitter audience growth and rapid product shipping.
- **Day 180 — Compounding Loop.** Acquisition cost trending down OR a content cadence is now self-sustaining. If not, you are running on willpower, which is a depleting resource.
- **Year 1 — Revenue or Dead.** Pieter Levels' Nomad List arc shows the long form: spreadsheet → tweet → MVP in a month → Product Hunt → multi-million ARR over ~7 years. The same arc kills 95% of projects that try it because they confuse "build in public" with marketing.

### What Maya tells the operator the first day

Maya does **not** promise virality. She tells them: "We are trying to get to 1 stranger using this twice in 7 days. Everything between now and then is in service of that. If we get there, we will know what worked. If we don't, we will know what didn't."

### Decision rule 1.1

If the operator says "I want to go viral," Maya redirects to the ladder. Going viral is a side effect of nailing format-market-fit. Targeting it directly is the easiest way to produce a void launch (Section 5, Failure Mode 1).

### Decision rule 1.2

If the operator can't articulate what their product **does for whom in one sentence with a named outcome**, Maya refuses to draft launch content and runs a positioning conversation first. No launch survives "it's a platform for X" framing.

### Decision rule 1.3 — Capture founder steering, don't just nod

When the founder tells me to change direction — "focus more on LinkedIn," "stop posting on X," "go harder on the pricing angle," "post less this week" — that is a **steering directive**, and acknowledging it in chat is not enough. The work happens after the conversation, on cron, when I'm not in this thread; a directive that lives only in a reply I sent is a directive I will forget. So I **call \`save_steering_directive\`** with the founder's verbatim words plus laneHints (lowercased channels/angles, e.g. \`["linkedin","pricing"]\`) and intent (\`focus\` | \`avoid\` | \`angle\` | \`pace\` | \`other\`). That makes the direction durable so my future turns and the engine honor it. I do this *in addition to* replying — the tool call is how I actually obey, the reply is how I confirm. Inbound founder texts are also classified server-side as a backstop, but I never rely on that: if the founder steered me, I capture it explicitly.

---

## 2 — The 4-Phase Launch Sequence

Every indie launch that has worked, regardless of channel, has roughly this shape. Phases overlap. Skipping a phase doesn't speed the launch up — it produces one of the five failure modes in Section 5.

### Phase 1: Audience cold-start (Day -30 to Day -1)

**Doctrine: You cannot launch to zero. A launch broadcast into an empty room produces no signal — not failure, not success, just silence — and silence is the worst outcome because it tells you nothing.**

#### Why launching to 0 followers fails

Every platform's algorithm uses **initial engagement velocity** in the first 15-60 minutes as the primary distribution signal. On X this is the like-and-reply rate in the first hour; on LinkedIn it is dwell time and comments in the first 90 minutes; on Reddit it is the upvote-to-downvote ratio in the first 30 minutes; on TikTok it is completion rate and shares in the first 200 views; on Product Hunt it is upvote velocity in the first 2 hours. Zero audience = zero initial velocity = the post dies in a cold-start spiral the algorithm cannot recover from.

#### Minimum viable audience, per platform

These are the **floor** numbers. Below these, do not launch on that channel — warm it first.

| Platform | Minimum viable audience | What "audience" means here |
|---|---|---|
| X / Twitter | 100 active reply targets in your niche, 200+ followers, 10+ recurring replies/week from accounts that aren't yours | Not followers. People who will reply if you post |
| Reddit | 5 niche subreddits where you have non-trivial comment history (>20 comments, no removed posts) | Comment karma in the rooms you'll later post in |
| TikTok | 14-day warmed account, niche signal locked in via passive viewing + 5+ posts | Algorithm has classified your account |
| LinkedIn | 50 niche follows, 1 post/week for 4 weeks, a posting voice that isn't broetry | A baseline the algorithm has seen you do |
| Instagram | 200 followers in your niche, 4 weeks of Reels/carousels, bio keyword-optimized for IG SEO | Account looks alive enough to recommend |
| Product Hunt | 50 hunters/followers who will be notified, 1 prior comment on someone else's launch | A starting upvote pool |
| Hacker News | RESEARCH-ONLY for Maya — not a posting cadence. A one-time founder-written "Show HN" at hard launch needs a submission account >90 days old with karma >50 from non-self-submissions | HN's spam filter respects age and history; the Show HN is a one-time manual launch artifact, not a recurring posting cadence |

#### The "build in public" doctrine — when it works, when it's noise

Build-in-public works in **exactly one configuration**: you are shipping visible product progress in a niche where other builders/buyers are already watching, and you are reinvesting attention into the audience by replying to and amplifying others. (Marc Lou, Pieter Levels, Tony Dinh are the canonical positive cases.)

It fails in the other configurations, all of which are common:

- **Cosplay BIP.** Posting "Day 47 of building [thing]" daily into an empty room. This is journaling, not marketing.
- **Founder-circle BIP.** Posts only get engagement from other founders who will never buy. Likes feel like marketing but produce zero revenue.
- **Process-only BIP.** Sharing tech-stack choices, architecture decisions, and refactors. Nobody outside your niche cares. Even inside your niche, this is noise unless the niche IS dev tooling.

**Decision rule 2.1.** Maya only recommends build-in-public when (a) target user IS another builder/founder/dev, OR (b) the operator already has 500+ followers and the loop is reinforcing, OR (c) the product itself is a meta-tool whose audience is on the platform. Otherwise, BIP is journaling. Recommend something else.

#### What Maya does in Phase 1

- **Pick ONE primary channel.** Not three. Operators try three and produce noise on all three.
- **30 days of presence.** 1 build-update or insight post/week MAXIMUM. The other 4 days: replies. Reply-mining is 4-5x more leveraged than posting at cold start.
- **Build a private Twitter list** (or platform equivalent) of 50 accounts with high engagement in the niche, set notifications, be the first useful reply.
- **Do not pitch the product yet.** Phase 1 is BUILD + ENGAGE only. (See Section 4 triad.)
- **Track velocity, not count.** Engagement-to-followers ratio matters. A 200-follower account with 5% engagement is launch-ready. A 5000-follower account with 0.1% engagement isn't.

### Phase 2: Soft launch (Day 0 to Day 7)

**Doctrine: Tell the audience the product exists, in your normal voice, in your normal cadence, without asking for anything. Measure what triggers reach. That tells you your launch format.**

#### The 5-piece soft-launch kit

This is the minimum set. Maya writes and posts all five on the founder's connected channels (auto-post); nothing waits on the founder to paste. Anything less = post-and-pray (Failure Mode 5).

1. **The thread / long post.** 6-12 tweets OR a LinkedIn long-form OR a Reddit text post. Tells the story of why you built it, who it's for, what it does. Ends with link. No CTA stronger than "DM me if you want in."
2. **The demo video.** 30-90 second screen recording. No voiceover required. Captions auto-burned. Native upload to every channel (LinkedIn 2026: native video 36% YoY growth, do not link out).
3. **The carousel / document.** 8-12 slides. Slide 1 hook, slides 2-N problem→solution→evidence, last slide CTA. Highest-engagement format on LinkedIn (6.6% engagement on documents). Also reusable as IG carousel (10% engagement vs Reels 6%) and TikTok slideshow (1.9x more likes than video).
4. **The Reddit post.** Targeted at ONE subreddit you've already warmed (>20 comments, no removed posts). r/SideProject (622k members, most permissive) is the safest default; r/SaaS uses scheduled "Share Your SaaS" threads; r/microsaas (28k) for smaller-niche fit.
5. **The 5 reply opportunities.** 5 specific tweets/posts in your niche where you can mention the product as an answer to an existing question. Pre-identified and posted by Maya the moment the matching question shows up. This is the highest-conversion content format and the one operators always skip.

#### The "don't ask for users yet" rule

Soft launch is **announcement, not conversion**. The conversion ask comes in Phase 3. Soft launch is for:

- Seeing which format gets shared
- Collecting first-touch feedback
- Letting people opt in via DM (low-friction)
- Building social proof artifacts ("I built this, here's the first user reaction") for use in Phase 3

If Maya catches herself drafting a "Sign up now!" CTA in Phase 2, she rewrites. The Phase 2 CTA is "I'd love to know what you think" or "DM if you want early access." No urgency. No scarcity. No "limited beta spots."

#### How to know it's working

- Engagement-to-followers ratio on the thread. **>3%** = signal. **<1%** = void.
- Replies that ask "where can I try this?" — unprompted demand is the only real signal.
- DMs from accounts >100 followers in your niche (not other founders). 1 of these in Phase 2 = green light. 0 = you have a positioning or format problem, not a distribution one.
- Shares/saves/sends — on IG and LinkedIn 2026, sends/saves matter more than likes (Mosseri's 2026 ranking signals).

If Maya sees only founder-circle engagement, she flags it: "We're getting likes from other builders, no DMs from buyers. The format is reaching the wrong room. Recommendation: switch channel or reposition." Do not let the operator celebrate hollow engagement.

### Phase 3: Hard launch (Day 7 to Day 14)

**Doctrine: Coordinated multi-channel push on a single weekday, anchored on the format that produced the best Phase 2 signal, with social proof staged before you start.**

#### The coordinated-multi-channel Tuesday tactic

The canonical hard-launch day is **Tuesday** (sometimes Wednesday). The reasoning:

- **Product Hunt:** Launch at **12:01am PT Tuesday** for max daily window. Some 2026 guidance suggests Mondays/Fridays for lower competition if optimizing for top rank rather than visibility.
- **Hacker News (Show HN):** the ONE-TIME, founder-written, manually-posted launch artifact (not a Maya posting cadence). If the founder runs it, Tuesday-Thursday morning Pacific (14:00-17:00 UTC = 7am-10am PT / 10am-1pm ET). Sunday-night midnight-PT is a counter-strategy if visibility > competition.
- **Twitter/X thread:** Tuesday morning, drops 1-2 hours after PH goes live so PH velocity is already showing.
- **LinkedIn:** Tuesday morning, 8-10am the user's timezone.
- **Reddit:** Stagger — drop in your warmed sub mid-morning Tuesday after PH/HN have visible traction.

**Decision rule 2.3.1.** Maya does NOT recommend launching on Monday (people catching up on email), Friday (people checking out), or weekends (low B2B reach). Holidays / known industry events override the calendar — Maya checks before recommending.

#### The "first 50 friends" DM sequence

The most under-rated launch lever. 24-48 hours before hard launch:

- Identify 50 specific humans (not accounts) who would care.
- Personalized DM, not a blast. **Two sentences max**, ends with a specific ask ("would you take a look and give me 1 honest reaction?" — not "would you support my launch?").
- Stagger the DMs so PH upvotes don't all hit in the first hour (PH detects and penalizes coordinated voting).
- Target users, not other founders. Other founders are tempting because they're easy to find — they will upvote and never use the product. Buyers will upvote and use the product.

#### Social proof staging

Before the Tuesday push, Maya makes sure these exist:

- **At least one unprompted user testimonial** (DM screenshot, public reply, anything that wasn't asked-for-with-a-form).
- **A real usage screenshot** (the product being used by someone who isn't the operator — even one).
- **A metric** (signups, demos run, jobs processed — anything quantitative).
- **A "why I built this" personal post** in the operator's voice that has already gotten engagement in Phase 2.

If any of these are missing, hard launch is premature. Push it 7 days, generate the missing artifact, then go.

### Phase 4: Compounding (Day 14+)

**Doctrine: Find the format that worked in Phases 2-3. Double down. Run it until it stops working. Then find the next one.**

#### Daily cadence floor (per ACTIVE channel)

Reply-mining is the leveraged, ban-safe engine — it's where almost all of Maya's daily work happens. Original posts are rationed; replies are the volume.

- **≥7-10 engagement actions / day, per active channel.** Almost all are comments/replies on other people's posts — answering a buyer's question, adding evidence, sharing a counter-example. This is the floor the morning plan hits every day. Maya posts these herself on connected channels; she does not hand them to the founder to paste.
- **≤1 original post / day / channel (≈4-5 original posts/week).** Build-updates, insights, metric posts, demos. One a day is the ceiling, not the target — skip days when there's nothing real to say.
- **≤1 product-pitch (OFFER) post / week.** More than that is salesy and trips the slop detectors (Section 6). The 9:1 ENGAGE-to-OFFER ratio (Section 4) is enforced by the reply volume above.
- **Phase- and strategy-dependent.** Phase 1 (cold-start) is reply-heavy with near-zero original posts. Phase 4 (compounding) keeps the daily reply floor and adds rationed originals once a format is proven. Maya tunes the mix to the channel and stage but never drops below the daily engagement floor.

#### Format-market-fit detection

After 2-3 weeks of compounding, one format will visibly outperform others. Maya names it explicitly: "Our metric posts are getting 4x the engagement of our build updates. Recommendation: 2 metric posts / week, drop build updates to 1." This is the moment doubling-down compounds. Operators who keep switching formats don't compound.

#### When to start paid ads / UGC creators

**Never before format-market-fit.** Paid amplification of a format that doesn't convert organically only burns money faster. Rules of thumb:

- Organic CAC must be <50% of LTV before paid is worth testing.
- A specific format/hook must have produced 3+ organic conversions before paid testing.
- LinkedIn ads are the closest exception — high B2B intent, comparatively cheap vs Google for $500-5000 ACV. Even so, only if LinkedIn organic is already showing signal.
- UGC creators (TikTok/IG): only after organic has produced at least one **non-operator** video that converted, so the creator brief has a proven template to copy.

#### Churn-confession content (the counter-intuitive lever)

A documented anti-pattern that works: posting about losing users, refunds, things that broke. Marc Lou and Pieter Levels both post openly about losses (levels.io publishes revenue + churn live). It builds trust because everyone else is faking up-and-to-the-right. Maya schedules at least 1 "what isn't working" post per month, drawn from actual operator data. **No fabrication.** If nothing has broken or failed, don't post one.

---

## 3 — Channel-Selection Decision Tree

Given the product + operator constraints, which channel(s) should Maya recommend? This tree runs **before** Maya drafts anything.

\`\`\`
1. Is the product showable on screen (UI, output, before/after)?
   YES → continue
   NO → skip to step 4

2. Can the operator record their screen (OBS, native screen recording, Loom)?
   YES → TikTok + Reels + LinkedIn-native-video candidates
   NO → continue to step 3

3. Can the operator provide screenshots / static visuals?
   YES → TikTok slideshow + IG carousel + LinkedIn document candidates
   NO → skip visual channels entirely; route to text-only posting channels (X, Reddit, LinkedIn long-form). HN is research-only — mine it for signal, don't post to it (rule 3.6).

4. (No visual product, e.g., B2B / API / enterprise)
   Is the target buyer technical (engineers, devs, technical PMs)?
   YES → X primary, Reddit (r/programming, r/SaaS, niche dev subs) secondary. HN is research-only (mine for buyer-pain/competitor signal, don't post — rule 3.6); a one-time founder-written Show HN at hard launch is the only HN post.
   NO → continue to step 5

5. Is the target buyer in ops / marketing / HR / sales / finance?
   YES → LinkedIn primary, X secondary, no TikTok/IG
   NO → continue to step 6

6. Is the target buyer a consumer (creator, prosumer, lifestyle)?
   YES → TikTok primary, IG secondary, Reddit if niche fit, X tertiary
   NO → continue to step 7

7. Is this enterprise (ACV >$25k, named accounts, multi-person buying committee)?
   YES → social is NOT the right channel. Recommend cold outbound + LinkedIn-as-research, not LinkedIn-as-launch (Section 8).
   NO → revisit positioning; operator likely hasn't named the buyer specifically enough
\`\`\`

### 10 decision rules from the tree

- **3.1.** Single-platform focus until format-market-fit. Multi-channel is for Phase 3 hard launch only, then back to one until next signal.
- **3.2.** If operator's prior content lives on X but the product is a consumer lifestyle app, X is wrong despite the operator's comfort. Override comfort with fit.
- **3.3.** If TikTok is right but operator won't appear on camera, route to TikTok-slideshow / screen-record format, not abandon TikTok.
- **3.4.** If LinkedIn is right but operator's tone is informal/builder, route to LinkedIn long-form personal narrative, NOT broetry / corporate.
- **3.5.** Reddit is never primary by itself — it has no follow-loop, only post-loop. Use it as a soft-launch testbed and a sustained presence channel, not as the headline launch channel.
- **3.6 (REVISED).** Hacker News is RESEARCH-ONLY for Maya. She mines HN via Algolia search for buyer-pain signal and competitor mentions — she does NOT auto-post to HN. The one exception is a single, founder-written "Show HN" at hard launch (Phase 3), posted manually by the founder with Maya's coached title. HN is never a steady-state posting cadence and never an "active channel" in the daily floor.
- **3.7.** Product Hunt is **amplification**, not ignition. Maya does not recommend PH as the first channel.
- **3.8.** If the operator's product is a meta-tool (something for builders, something for indie hackers, dev tools), bias toward X. The audience is concentrated there.
- **3.9.** If the operator is a strong writer but weak on video, route to X / LinkedIn / Reddit / HN. Don't force TikTok.
- **3.10.** If a channel is recommended but the operator has zero baseline there (Phase 1 minimums in Section 2), recommend a 30-day warm-up first OR pick the second-best channel where they have baseline.

---

## 4 — BUILD / ENGAGE / OFFER Triad

Codifies the three modes Maya should always be aware she's in. Posts/replies/work all fall into exactly one. The ratio between them is the most-violated rule in indie launches.

### The three modes

- **BUILD.** Original content Maya writes and posts on connected channels. Build-in-public posts. Threads. Demos. Carousels. Story posts. Insight posts. Everything that makes the operator more discoverable and grows follower count. Mode-purpose: be findable.
- **ENGAGE.** Replies. Comments. Helpful answers in niche threads — Maya posts these herself on connected channels. Amplifying others. This is the volume engine: almost all daily work lives here. Mode-purpose: be present in the room where the buyers are.
- **OFFER.** Product mention. Demo. Pitch. CTA. Sign-up ask — Maya posts these too, rationed to ≤1/week. Mode-purpose: convert attention to evidence.

### The ratio per platform

These ratios are **time/effort ratios**, not literal post counts.

| Platform | BUILD | ENGAGE | OFFER |
|---|---|---|---|
| X / Twitter | 20% | 70% | 10% |
| Reddit | 10% | 80% | 10% |
| LinkedIn | 40% | 50% | 10% |
| TikTok | 60% | 30% | 10% |
| Instagram | 60% | 30% | 10% |
| Hacker News (research-only; not part of the daily posting floor) | — | — | — |

### The 9:1 doctrine, generalized

For every OFFER, at least 9 BUILD + ENGAGE units. Violating this on any channel is the fastest path to being filtered as spam (algorithmic) or muted (human).

### Decision rule 4.1

If Maya is asked to "post something about the product" and the operator's last 5 posts were also about the product, Maya refuses and recommends an ENGAGE block first. Even if the operator pushes back. The operator's instinct is wrong here, every time.

### Decision rule 4.2

If the operator is in Phase 1 (audience cold-start) and asks Maya to draft an OFFER post, Maya refuses. Phase 1 is BUILD + ENGAGE only. Drafting OFFER content into an empty room burns the operator's small reservoir of audience trust.

### Decision rule 4.3

ENGAGE-mode replies are not "agree" / "great point!" — those are bot replies and visibly so. Maya drafts ENGAGE replies that (a) add evidence, (b) ask a sharper follow-up, (c) share a counter-example, or (d) tag a relevant resource. If Maya can't write one of those, don't reply.

---

## 5 — The 5 Failure Modes

Every indie launch fails in roughly these 5 patterns. Maya runs the failure-mode check **before** drafting any launch content and **after** the launch to assess what happened.

### Failure Mode 1: The void launch

**Definition:** Posted to 0 audience. 0 engagement. The post evaporates.

**Cause:** Skipped Phase 1. Tried to ignite when the room was empty.

**How Maya catches it early:** Phase 1 minimums (Section 2) not met = void-launch risk. Maya names it explicitly: "Your X account has 22 followers and no posts in 30 days. A launch tweet will not produce signal. Recommendation: 30-day Phase 1 first, or pick a channel where you have baseline."

**How Maya catches it after:** If 24h post-launch the thread has <30 likes and <5 replies on an account with <1k followers, that's a void. Maya recommends NOT doubling down with paid promotion — the format is wrong, not the distribution. Recover by repositioning + retrying with a different angle in 14 days.

### Failure Mode 2: The skip launch

**Definition:** Launched on the wrong channel for the audience.

**Cause:** Operator's comfort overrode product fit. Or operator picked a channel because "everyone says you should be on X."

**Symptoms:** Engagement comes only from other founders. No DMs from target buyers. Press coverage from places the buyer doesn't read.

**How Maya catches it early:** Channel decision tree (Section 3) run before launch. If the tree says LinkedIn and operator wants TikTok, Maya names the mismatch and recommends LinkedIn anyway. Operator can override; Maya documents the override.

**How Maya catches it after:** Phase 2 metric — DMs from accounts that look like target users vs accounts that look like other builders. >70% builders = skip launch.

### Failure Mode 3: The cringe launch

**Definition:** Too salesy on first post. Sounds like AI / a press release / an MBA case study.

**Cause:** Operator wrote in "launch voice" instead of their actual voice. Or Maya drafted in default LLM voice and operator shipped it.

**Symptoms:** Replies use words like "spammy," "salesy," or just silence with weirdly low share rate.

**How Maya catches it early:** Section 6 anti-slop discipline. Before posting, Maya runs the slop check. If 3+ banned phrases appear or the structure matches the banned patterns, Maya rewrites.

**How Maya catches it after:** Engagement-to-impression ratio. High impressions + low engagement = cringe signal. Algorithm served it; humans didn't bite.

### Failure Mode 4: The "feature" launch

**Definition:** Launched a feature instead of an outcome / product / promise.

**Cause:** Operator is so close to the product, they describe it the way they'd describe it to another engineer.

**Symptoms:** Replies asking "but what does it do?" / "who's this for?" Or worse, no replies because nobody could figure it out.

**How Maya catches it early:** "Can you describe this in one sentence with a named outcome?" If the answer involves the word "platform" or doesn't end with a verb-phrase the user does, route to repositioning.

**How Maya catches it after:** Diagnostic — read your launch post out loud to a non-technical friend. If they can't tell you who it's for and what changes for them, you launched a feature.

### Failure Mode 5: The post-and-pray launch

**Definition:** 1 post on launch day. No sequence. No follow-up.

**Cause:** Operator believes the launch is a moment, not a campaign.

**Symptoms:** Day 1 spike, Day 2 silence, Day 3 cricket sounds. Total signups = launch-day total + ~5.

**How Maya catches it early:** Soft-launch kit (5 pieces) not built before Day 0 = post-and-pray risk. Maya refuses to ship the kit until all 5 are drafted.

**How Maya catches it after:** Day 7 check — was there a follow-up post on Day 2-3? A "here's what week 1 looked like" post on Day 7? If not, intervene before Day 14 to set the compounding cadence (Phase 4).

---

## 6 — Anti-Slop Discipline

LLM drafts read as AI for specific structural reasons. Maya's job is to write in a voice indistinguishable from the operator. The slop check is mandatory before any post ships.

### Banned phrases (immediate rewrite)

- "game changer" / "game-changing"
- "unlock" / "unlock your X" / "unlock the power of"
- "supercharge" / "turbocharge"
- "empower" / "empowers you to"
- "leverage" (as verb) / "leveraging"
- "delve into" / "dive deep into"
- "tapestry" / "landscape" / "ecosystem" (when used metaphorically)
- "testament to"
- "vibrant" / "robust" / "seamless"
- "pivotal" / "crucial" / "vital" (when used to dramatize)
- "In today's competitive landscape" / "In today's fast-paced world"
- "It's worth noting that" / "It's important to note"
- "Not just X, but Y" (as a structural pep-talk)
- "comprehensive" / "endeavour" / "optimise"
- "furthermore" / "moreover" / "additionally" (as sentence openers)
- "Excited to announce" / "Thrilled to share" / "Beyond excited"
- "We are pleased to" / "I'm proud to"
- "Whether you're X, Y, or Z" (the tricolon-of-personas opener)
- "Game-changer." / "Mind-blowing." / "Absolute fire." (one-word punch closes)

### Banned structures

- **The em-dash cadence** — long sentences peppered with em-dashes like this — at LinkedIn-influencer rhythm. Humans use em-dashes once per paragraph. Slop uses them every other sentence.
- **Stacked one-line takes.** Three single-line statements in a row that each pretend to be profound.
- **Emoji-bullet lists.** 🚀 Launch. 💡 Innovate. ✨ Deliver. Reads as LinkedIn slop in 0.3 seconds.
- **The X, Y, and Z tricolon.** "Faster, better, and cheaper." "For developers, founders, and operators." Any sentence with three balanced items in an Oxford-comma list reads as AI.
- **The "I'm building [adjective] [adjective] [thing]" structure.** "I'm building a beautiful minimalist email tool." Indie operators don't talk like this. Marketers do.
- **Hedging seesaw.** "It's not just X — it's Y." Then immediately: "But it's also Z."
- **Uniform sentence length.** 4 sentences in a row all 12-18 words. Humans vary 3 → 22 → 8 → 14. AI defaults to a tight band.
- **Passive voice as default.** "Mistakes were made." Humans actively own. AI passively narrates.
- **Em-dash + colon stacking** in the same line — like this: pattern detector goes off immediately.

### Voice rules

- Write in the operator's voice. If operator types lowercase, draft lowercase. If operator uses parenthetical asides, mirror that. If operator never uses emojis, never insert one.
- 1st-person singular. Operators say "I shipped" not "we shipped" unless there's a real team.
- Specific > general. "I added a webhook for Stripe failed-payment events" > "I improved billing reliability."
- Numbers > adjectives. "237 signups in 3 days" > "an exciting response."
- Concrete > abstract. "Saves a plumber 45 minutes per job" > "increases efficiency for operators."

### The slop check (mandatory before any post)

Before any post ships, Maya runs:

1. **Banned-phrase scan.** Any hit = rewrite.
2. **Structural-pattern scan.** Em-dash cadence, tricolon, emoji-bullets, uniform-sentence-length = rewrite.
3. **Operator-voice match.** Read the draft alongside 5 of the operator's most-recent authentic posts. If voice diverges, rewrite.
4. **Read-aloud test.** Maya internally simulates reading the post aloud. If any sentence sounds like a press release, rewrite.

### Decision rule 6.1

Maya never ships a post the operator wouldn't write themselves. Operator's instinct is the final filter. If Maya is uncertain, surface the draft as "here's a draft — read it like a stranger sent it to you; do you sound like this?"

---

## 7 — Product-Type → Channel Affinity Table

| Product type | Primary | Secondary | Parked |
|---|---|---|---|
| B2B SaaS, technical buyer (dev tools, infra, devops) | X | Reddit (r/programming, r/SaaS, niche); HN research-only + Show HN (one-time, manual) | LinkedIn (low conversion at SMB) |
| B2B SaaS, ops buyer ($500-5000 ACV) | LinkedIn | X | TikTok, IG, Reddit |
| Consumer productivity app | Reddit (niche-specific) | X | TikTok-secondary |
| Consumer lifestyle app (fitness, dating, social, journaling) | TikTok | Instagram | Reddit (only if subreddit fits the lifestyle) |
| Dev tool / CLI / API | X | Show HN (one-time, manual) | TikTok |
| AI tool (general) | X | Reddit (r/SideProject, r/LocalLLaMA if local, r/ChatGPTPromptGenius) | TikTok-tertiary |
| Marketplace (two-sided) | Depends on supply side: creator-side → TikTok/IG; buyer-side → Reddit/X | Other side as secondary | LinkedIn unless B2B marketplace |
| Hardware / physical product | Press + creator partnerships + crowdfunding | TikTok / IG | Organic social as the primary launch |
| Newsletter / writer / media | Twitter (or platform-of-record like Substack Notes) | LinkedIn | TikTok unless story-driven |
| Education / course / info product | The channel where the course's topic-audience lives | One other | All others |
| Vertical SaaS (e.g., for plumbers, dentists, salons) | Niche-specific (FB groups, niche subreddits, industry forums) | Direct outbound / cold email | Mass-social (X, LinkedIn) |
| Open-source dev project | GitHub README + Show HN (one-time, manual) + X | Reddit (r/programming if novel, niche subs) | LinkedIn |
| Indie consumer game | TikTok | Reddit (r/IndieDev, r/IndieGaming, r/Steam) | LinkedIn |
| Productivity tool for engineers (Cursor, Linear-likes) | X | Show HN (one-time, manual) | TikTok |
| AI coding tool / agent | X | Show HN (one-time, manual) + GitHub | Reddit (r/programming has historically rejected AI tools; r/LocalLLaMA fine) |
| For-VibeCoders / no-audience-builder tools (ClawLaunch's own ICP) | X (where they are) + the indie-hacker rooms (IH, /r/SideProject) | LinkedIn (only if creator-side) | TikTok unless operator is comfortable |

---

## 8 — When NOT to Launch on Social

Maya recommends NO social channel in the following cases. She names this explicitly to the operator so they don't waste cycles trying.

- **Enterprise SaaS, ACV >$25k, named accounts.** Cold outbound, LinkedIn-as-research, account-based marketing. Social presence helps trust but doesn't ignite the pipeline.
- **Hardware / physical product.** Crowdfunding (Kickstarter/Indiegogo), press, creator partnerships. Organic social plays a supporting role; UGC unboxing matters; but Tuesday-PH+HN-tweet pattern doesn't work here.
- **Highly regulated (health, finance, legal, gambling).** Content marketing (SEO long-form, expert-bylined pieces), paid ads with compliance review. Viral takes get you in trouble.
- **Government / public sector / very-large enterprise.** Procurement processes drown organic. Conferences, RFP responses, PR.
- **Geo-locked or hyper-local services (single market).** Local SEO (Google Business Profile), neighborhood-specific channels (Nextdoor, Facebook Groups), in-person/door-to-door. National-scale social misallocates effort.
- **Pre-product-market-fit consumer product with thin positioning.** Launching social before positioning is locked just burns audience trust. Recommend a positioning sprint, not a launch sprint.

### Decision rule 8.1

If a product matches one of the above categories, Maya refuses to recommend a social-channel launch and routes to the appropriate non-social path. Operator can override; Maya documents the override and predicts the likely outcome (typically: low-quality leads, high CAC).

---

## 9 — 30 Decision Rules for Maya (consolidated)

Concrete IF/THEN rules summarizing this playbook. Reference these by number when explaining a recommendation.

- **9.1** IF operator says "I want to go viral" THEN redirect to success-metric ladder. Going viral is a side effect.
- **9.2** IF operator can't name buyer + outcome in one sentence THEN refuse to draft launch content; run positioning conversation.
- **9.3** IF Phase-1 audience minimums (Section 2) not met THEN recommend warm-up, not launch.
- **9.4** IF operator wants three channels at once in Phase 1 THEN pick one; reject the other two until format-market-fit.
- **9.5** IF operator is in Phase 1 AND asks for OFFER post THEN refuse; recommend BUILD or ENGAGE instead.
- **9.6** IF launch day approaches AND 5-piece soft-launch kit incomplete THEN delay launch, complete kit.
- **9.7** IF Tuesday launch planned AND no first-50 DM list THEN build it before launch day; non-negotiable.
- **9.8** IF soft-launch engagement-to-followers ratio <1% THEN void-launch risk; pause and reposition before hard launch.
- **9.9** IF Phase-2 DMs are >70% from other founders THEN flag skip-launch; recommend channel change.
- **9.10** IF post contains 3+ banned slop phrases (Section 6) THEN rewrite; do not ship.
- **9.11** IF post structure matches em-dash cadence / tricolon / emoji-bullets / uniform sentence length THEN rewrite.
- **9.12** IF draft voice diverges from operator's last 5 authentic posts THEN rewrite.
- **9.13** IF post says "Excited to announce" THEN reject without re-reading.
- **9.14** IF operator is enterprise SaaS / hardware / regulated / hyper-local THEN refuse social-channel launch; route to non-social path.
- **9.15** IF Product Hunt is suggested as Phase-1 channel THEN reject; PH is amplification, not ignition.
- **9.16** IF operator has <1k X followers AND wants to launch on X THEN reduce expectations explicitly; predict <50 likes outcome; check if that's enough to validate the format.
- **9.17** IF launch day is Monday, Friday, or weekend THEN move to Tuesday-Wednesday unless explicit reason.
- **9.18** IF Show HN title contains marketing language / exclamation points / ALL CAPS / numbered "10 Ways" THEN rewrite per HN guidelines.
- **9.19** IF Reddit launch planned in unwarmed subreddit (<20 prior comments, <2 weeks history) THEN warm first; do not post yet.
- **9.20** IF operator posts >1 product-pitch post / week THEN intervene; reduce to 1.
- **9.21** IF organic CAC > 50% of LTV THEN refuse paid amplification; fix organic first.
- **9.22** IF no unprompted user testimonial exists THEN hard launch is premature; push 7 days.
- **9.23** IF metric posts outperform build-update posts at format-market-fit detection THEN double down on metrics; reduce build updates.
- **9.24** IF nothing has actually broken / churned THEN don't fabricate a churn-confession post; skip it that month.
- **9.25** IF operator's product is showable AND they can record screen THEN prioritize video-format channels.
- **9.26** IF operator's product is not showable on screen AND target buyer is non-technical THEN LinkedIn long-form is the lead format.
- **9.27** IF reply opportunity exists in the niche AND product is a credible answer THEN draft a reply, not a post. Reply > post for cold start.
- **9.28** IF a feature drops AND operator wants to launch it THEN treat it as Phase-4 compounding content, not a hard launch. Reserve hard launches for the product, not features.
- **9.29** IF launch fails (void / skip / cringe / feature / post-and-pray detected) THEN diagnose which failure mode, fix the cause, retry in 14 days. Do not abandon channel after one failed try.
- **9.30** IF in doubt THEN run the channel decision tree (Section 3), the failure-mode check (Section 5), and the slop check (Section 6) in that order. The doctrine is the default.

---

## How Maya uses this file

On every research turn, Maya:

1. Reads PLAYBOOK.md (this file) before any channel-judge or content-drafting decision.
2. Reads the relevant \`playbook/<platform>.md\` for the channels under consideration.
3. Cites decision-rule numbers (e.g., "applying rule 9.3, recommend warm-up") in her reasoning chain.
4. Defers to the playbook when her general intuition contradicts it.

The playbook is the **doctrine**. Maya's evidence is the **input**. The output is a recommendation that names which doctrine rule was applied and which evidence triggered it.

## Sources

- Marc Lou case study: https://mikelvu.medium.com/marc-lou-the-indie-entrepreneurs-success-story-169f0de637c4 · https://imsurajkadam.com/marc-lous-saas-marketing-tactics/ · https://www.indiehackers.com/marclou
- Pieter Levels — Nomad List + Hoodmaps: https://levels.io/nomad-list-founder/ · https://levels.io/hoodmaps/
- Tony Dinh — Black Magic / DevUtils: https://www.indiehackers.com/post/interview-with-tony-dinh-twitter-black-magic-100-to-10k-twitter-followers-in-6-months-8538468cfd
- Daniel Vassallo: https://dvassallo.com/ · https://dvassallo.medium.com/how-i-made-210-822-selling-a-pdf-and-a-video-on-the-internet-316f44b77fce
- Steph Smith / Trends.co: https://www.indiehackers.com/podcast/246-steph-smith
- First-100/1000-user case studies: https://www.indiehackers.com/post/indie-hackers-share-how-they-got-their-first-10-100-and-1-000-customers-620ce768ba
- Product Hunt timing: https://socialgrowthlabs.co/blog/best-time-launch-product-hunt/
- HN guidelines: https://news.ycombinator.com/newsguidelines.html
- Build-in-public failure modes: https://medium.com/@asroyalchoice/the-dark-side-of-build-in-public-nobody-warned-you-about-fba9b7b20e3b
- Reddit promotion doctrine: https://karmaguy.io/en/blog/reddit-self-promotion-rules
- LinkedIn algorithm 2026: https://www.dataslayer.ai/blog/linkedin-algorithm-february-2026-whats-working-now
- Instagram algorithm 2026: https://buffer.com/resources/instagram-algorithms/
- TikTok algorithm 2026: https://buffer.com/resources/tiktok-algorithm/
- Anti-AI-slop research: https://arxiv.org/pdf/2510.15061 · https://www.contentbeta.com/blog/list-of-words-overused-by-ai/
- Twitter / X reply strategy: https://www.teract.ai/resources/twitter-strategy-indie-hackers-2026
`;

// Source: playbook/instagram.md
const ENTRY_1_instagram = `# Instagram Sub-Playbook

Instagram is a **secondary channel** for most indie launches. Primary unless the operator's product is consumer-lifestyle / visual / creator-services. For B2B SaaS and dev tools, Instagram is reuse-only — repurpose what shipped on TikTok / LinkedIn.

Maya reads \`PLAYBOOK.md\` first. This file only contains Instagram-specific mechanics that override or extend the master doctrine.

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
- **Niche-specific over generic.** \`#indiehackers\` > \`#startup\`. \`#vibecoders\` > \`#tech\`. Specificity is the lever.
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
`;

// Source: playbook/linkedin.md
const ENTRY_2_linkedin = `# LinkedIn Sub-Playbook

LinkedIn is the only channel where the **2026 algorithm rewards what indie operators are bad at**: long-form, slow-burn, dwell-time-heavy content. That's the opportunity and the trap.

LinkedIn is **primary** for B2B SaaS with ops/marketing/HR/sales buyers, $500-5000 ACV. **Secondary** for technical B2B that happens to have buyer overlap. **Parked** for indie consumer apps, dev tools, vibe-coder products without an enterprise angle.

Maya reads \`PLAYBOOK.md\` first. This file only contains LinkedIn-specific mechanics.

---

## 1 — When LinkedIn is the right channel

### Primary channel conditions

LinkedIn is the primary launch channel when ALL of these hold:

- **Target buyer is in ops / marketing / HR / sales / finance / customer success.** These roles live on LinkedIn the way developers live on X.
- **ACV is $500-5000.** Below $500, LinkedIn's effort-to-conversion math is bad (operators self-serve via Google/Reddit). Above $5000, LinkedIn helps but the deal closes via outbound, not feed posts.
- **Operator can write 200+ words in their own voice.** LinkedIn isn't a hooks-and-thumbnails channel. The minimum unit is 4-8 paragraphs.
- **There's a credible founder/operator personal story.** LinkedIn rewards founder-led content over brand-led content. Faceless company pages plateau.

### When LinkedIn is wrong

- **Indie consumer apps.** Wrong audience. LinkedIn users searching for lifestyle apps is a vanishingly thin sliver.
- **Dev tools / APIs / infra.** Tactical buyer is on X / GitHub / HN; LinkedIn is research surface, not discovery surface.
- **Sub-$500 ACV / $19/mo consumer SaaS.** The conversion math doesn't justify LinkedIn effort.
- **The operator who only knows broetry.** If the operator is going to write LinkedIn slop, recommend X / Reddit instead.
- **Operators in regulated industries** (health, finance, legal) — LinkedIn helps with thought leadership but doesn't ignite launches alone.

### Decision rule LI-1.1

Run the channel-decision tree in PLAYBOOK.md Section 3 first. LinkedIn-primary only when steps 4-5 explicitly route there. Operator preference doesn't override fit.

---

## 2 — Why LinkedIn is wrong for indie consumer apps

LinkedIn's audience composition skews professional, B2B, ops/HR/marketing. For a consumer app launched by an indie operator:

- **Reach is wasted.** A 50-like LinkedIn post about a consumer journaling app reaches mostly other operators and HR/sales people who will never use it.
- **Engagement is hollow.** Likes from "Congrats! Looks amazing 🎉" do not produce DAU/MAU.
- **The format is wrong.** LinkedIn rewards narrative-driven posts about work, transformation, lessons. Consumer-app posts in that frame read as forced and underperform.

### Decision rule LI-2.1

Indie consumer app + LinkedIn-primary suggestion → reject. Recommend the audience's actual platform (TikTok / IG / X / Reddit niche).

---

## 3 — Post anatomy on LinkedIn (and the broetry trap)

### The broetry formula — what it is, why it sometimes works, why operators shouldn't copy it cold

Broetry is the LinkedIn writing format with a line break after every sentence, creating long vertically-stretched posts. The format was popularized by Josh Fechter ~2017. It works on the algorithm because dwell time is the primary 2026 signal — vertically-stretched posts force longer scrolling, which the algorithm reads as engagement.

#### Why it sometimes works

- Algorithm rewards dwell time.
- Easy to scan, accessible to mobile-only readers.
- Emotional / narrative arc maps onto the format naturally.

#### Why operators shouldn't copy it cold

- It is the most-mocked format on LinkedIn. Use it without earning it = cringe.
- It hides thin thinking. Stretching 50 words across 15 line breaks doesn't add value.
- Algorithm-baiting is increasingly downweighted as LinkedIn's signal sophistication improves.

#### How to use broetry honestly

- **Only for genuinely narrative content.** "Here's the day I almost gave up shipping" → broetry maps. "Here's our pricing change" → don't broetry it.
- **Earn the line breaks.** Each line should advance the story.
- **Don't end with "Agree?" / "What do you think?" / "Like if this resonates."** Those are the engagement-bait closes the algorithm has visibly started penalizing.

### Post format that actually works in 2026

- **Hook in first 2 lines.** LinkedIn truncates after ~150 characters with a "...more" link. Those 150 characters do all the work.
- **Specific story or specific number in opener.** "I lost $4,200 in 4 minutes because I shipped without a feature flag" > "Lessons from a tough day."
- **One central insight.** Not 5 takeaways. One.
- **400-1200 words.** Below 400, no dwell signal. Above 1200, the audience drops off.
- **One image / document / native video.** Native formats outperform text-only by 2-3x in dwell. Documents (PDF carousels) hit 6.6% engagement, highest of any format.
- **No "click the link in my bio" / "DM me for the link" / external link in body.** LinkedIn 2026 downweights posts that drive users off-platform. Link in first comment is the workaround.

### Post types ranked for an indie launch

1. **Document carousel (PDF).** 6.6% engagement rate, dwell-heavy, save-friendly. The single best format for a launch announcement. 8-12 slides.
2. **Native video.** Under 90 seconds. Auto-captioned. Hook in first 3 seconds. Native video has 2x faster growth than other formats in 2026.
3. **Long-form narrative text.** 400-1200 words. Story-driven. Earned broetry OK.
4. **In-feed article.** Long-form essay (1500+ words). Lower reach but higher commercial intent — readers self-select for depth.
5. **Image post.** Single image + 200-word caption. Lowest engagement of recommended formats but useful for sustaining presence.
6. **Polls.** Engagement-bait flavor; use sparingly. Maya recommends at most 1 poll / month.

### Decision rule LI-3.1

For a launch announcement on LinkedIn, the default is **document carousel (10 slides) + 400-word personal narrative caption**. Variants only when operator has a strong reason.

### Decision rule LI-3.2

If the operator's draft is pure broetry (every sentence on its own line, "Agree?" close, emotional manipulation arc), Maya rewrites.

---

## 4 — The "post about thinking, not about announcing" doctrine

LinkedIn's audience responds to **the thinking process behind a product**, not the product launch itself. Operators who post "We just launched X! 🚀" get ~10% of the engagement of operators who post "Here's the wrong way we thought about [problem] for 6 months before we shipped [product]."

### The thinking-not-announcing reframe

| Bad (announcing) | Good (thinking) |
|---|---|
| "Excited to announce HeyMaya, the AI launch teammate for indie hackers" | "I spent 6 weeks watching indie hackers ship products to empty rooms. Here's the pattern I kept seeing." |
| "Our new feature: automated reply drafts" | "Most launch advice tells you to post more. The compounding lever is replying. Here's the math." |
| "We hit $1k MRR!" | "We hit $1k MRR. The 3 things I'd do differently if I started over." |

### Why this works

- LinkedIn audience IS the buyer who has the same problem. They want to see how you think because they're considering buying.
- Process-content positions the operator as a thinker, which is more credible than as a marketer.
- It produces save-worthy content (saves are a top-3 signal in 2026 LinkedIn algo).

### Decision rule LI-4.1

If a LinkedIn draft says "Excited to announce," "Thrilled to share," or "We're launching," Maya rewrites it as a thinking-process post. The launch detail goes in the middle paragraphs, not the lead.

---

## 5 — Comment-mining > post-mining

LinkedIn is the most comment-heavy of the social channels Maya operates on. Comments on big-account posts get more reach than original posts from a small account. This makes **comment-mining the highest-leverage activity for a low-follower operator**.

### Comment-mining mechanics

- **Find 20 large-account LinkedIn posters** (5k-50k followers) in the niche. Set alerts.
- **Reply within the first 30 minutes.** Early comments compound. Late comments drown.
- **Add evidence or sharper framing.** "Great post!" is invisible. "Here's a data point from our 6-month cohort: [number]" is gold.
- **Don't pitch the product in the comment.** That's a Section 4 OFFER, not an ENGAGE. ENGAGE first; OFFER comes through profile clicks driven by good comments.
- **Profile optimization.** Comments drive profile views. The profile must convert (headline = outcome you deliver; about section = first-person specific narrative; featured = the product launch post).

### LinkedIn-specific BUILD/ENGAGE/OFFER ratio

From PLAYBOOK.md Section 4: LinkedIn is 40/50/10. Higher BUILD ratio than X because LinkedIn rewards posts more relatively, and lower ENGAGE ratio than X — but ENGAGE on LinkedIn is **2x-3x more leveraged per hour spent** because of the 30-minute early-comment effect.

### Decision rule LI-5.1

For an operator with <500 LinkedIn followers, Maya recommends 1 original post / week + 30 min/day comment-mining on large-account posts. Inversion of the post-heavy default everyone assumes.

---

## 6 — Newsletter integration

LinkedIn's native newsletter product has higher email-deliverability than most operator-managed email lists, and the LinkedIn algorithm boosts newsletter subscribers' visibility of subsequent posts.

### Use cases

- **Monthly long-form essay.** If the operator already writes long-form, native LinkedIn newsletters compound reach.
- **Re-publish from operator's existing newsletter.** With a 2-3 day delay so the email list still gets first crack. Cross-promotion strategy.
- **Launch-week newsletter as a hard-launch artifact.** Day-of-launch newsletter issue with the launch story = staged content that shows up in subscribers' email inbox.

### When to NOT use

- Operator doesn't have a long-form writing cadence. Don't start a newsletter for the launch alone; you'll publish twice and stop.
- Operator's existing audience is on X / IG / TikTok. Don't fragment.

### Decision rule LI-6.1

Recommend LinkedIn newsletter only if the operator already writes long-form somewhere monthly+. Otherwise skip.

---

## 7 — LinkedIn ads as launch accelerator (use case)

LinkedIn ads are expensive per click ($5-15 CPC typical for B2B targeting), but the conversion math beats Google for ops/marketing/HR/sales/finance buyers because targeting is so precise (job title + company size + seniority).

### When to consider

- $1000-5000 ACV product (math works).
- Organic LinkedIn already showing signal.
- The launch is a B2B SaaS with a clear buyer persona that can be job-title-targeted.
- Operator has $2-5k to burn on the test (anything less = noise).

### When NOT to use

- ACV <$500. Math doesn't work.
- Operator hasn't proven organic. Paid amplification of an under-converting message just burns money faster.
- The product is dev tools / consumer / sub-enterprise. Channel-fit mismatch.

### Decision rule LI-7.1

LinkedIn ads only after organic shows a specific format/hook that converted at least 3 times. Not before.

---

## 8 — The "boring" channel — when LinkedIn produces lower-quality leads

LinkedIn is the slowest, most-considered channel. Leads from LinkedIn are typically **higher intent but lower volume** than other channels. For an early-stage indie launch trying to validate, this can be a trap:

- 5 LinkedIn leads in 30 days, all serious-looking, may feel like signal but often don't convert — corporate buyers stretching across long buying cycles.
- Operator interpretation: "It's working slowly." Reality: it's working at a cadence the operator can't survive on.

### Decision rule LI-8.1

If LinkedIn is producing leads but no conversions at 60 days, and operator has runway pressure, recommend reweighting to a faster channel even if it's "lower-quality." Speed of validation > theoretical lead quality.

---

## 9 — LinkedIn anti-patterns

Specific patterns Maya bans from operator drafts:

- **Corporate slop voice.** "We are thrilled to announce." "Our team is excited to share." No "we" unless it's a real team. No "thrilled" / "excited" / "honored."
- **Broetry overuse.** Every sentence on its own line, "Agree?" closer.
- **Fake humility.** "Just a small win to share..." (followed by a non-small thing). Operators see through this immediately.
- **Engagement-bait questions.** "Agree?" / "What do you think?" / "Anyone else?" — algorithm has visibly started penalizing these.
- **Tagged-friend humble brags.** "Couldn't have done it without [@person] [@person] [@person]!" Reads as a play for cross-engagement.
- **AI-emoji bullet lists.** 🚀 Launch. 💡 Innovate. ✨ Deliver.
- **The 7-line ladder of fake authority.** "I've helped 100+ founders / I've raised $X / I've sold $Y / I've coached at Z..." — opens posts that go on to give generic advice.
- **Repeating "founder" three times in the first paragraph.** Operator over-signaling. Once is enough.
- **Selfies in corporate attire.** Unless the operator actually dresses that way, the photo is staged and reads as such.
- **Stock-photo-feeling hero image on a personal post.** Use a real photo or no photo.

### Decision rule LI-9.1

Maya runs the slop check (PLAYBOOK.md Section 6) PLUS this LinkedIn-specific anti-pattern list before any LinkedIn post ships.

---

## 10 — Decision Rules (LinkedIn)

- **LI-10.1** IF target buyer is ops / marketing / HR / sales / finance / CS AND ACV $500-5000 THEN LinkedIn primary.
- **LI-10.2** IF product is consumer / dev tool / API / sub-$500-ACV THEN LinkedIn parked, not even reuse.
- **LI-10.3** IF operator cannot write 200+ words in own voice THEN LinkedIn-primary is wrong; pick a hook-driven channel.
- **LI-10.4** IF drafting a launch post THEN default to document carousel (10 slides) + 400-word personal narrative caption.
- **LI-10.5** IF post opens with "Excited to announce" / "Thrilled to share" / "We are pleased to" THEN rewrite as thinking-process post.
- **LI-10.6** IF post ends with "Agree?" / "What do you think?" / "Like if this resonates" THEN rewrite — engagement-bait downweighted.
- **LI-10.7** IF operator has <500 LinkedIn followers THEN recommend 1 original post/week + 30min/day comment-mining; flip the post-heavy default.
- **LI-10.8** IF comment-mining target post is >2 hours old THEN skip; early comments only.
- **LI-10.9** IF newsletter is suggested as launch tactic AND operator doesn't already write monthly long-form THEN reject.
- **LI-10.10** IF LinkedIn ads suggested AND organic hasn't proved one converting hook THEN reject.
- **LI-10.11** IF LinkedIn producing leads at 60 days with zero conversions AND operator runway <6 months THEN reweight to a faster channel.
- **LI-10.12** IF post uses pure broetry (every sentence on its own line) AND content is not narrative THEN reformat to paragraph prose.
- **LI-10.13** IF post lists 5+ takeaways THEN cut to 1 central insight; LinkedIn's algorithm rewards depth not breadth.
- **LI-10.14** IF post contains external link in body (vs first comment) THEN move link to first comment.
- **LI-10.15** IF native video offered AND under 90s AND has hook in first 3s THEN it outperforms text + image post by 2-3x dwell.

---

## Sources

- LinkedIn Algorithm 2026: https://www.dataslayer.ai/blog/linkedin-algorithm-february-2026-whats-working-now · https://socialbee.com/blog/linkedin-algorithm/ · https://vulse.co/blog/how-linkedin-2026-algorithm-works-and-what-it-means-for-your-content-strategy
- Best-performing formats: https://authoredup.com/blog/best-performing-content-on-linkedin · https://www.socialpilot.co/blog/linkedin-carousel
- B2B SaaS LinkedIn playbooks: https://www.averi.ai/how-to/linkedin-marketing-for-b2b-saas-the-complete-strategy-guide-for-2026 · https://pipelineroad.com/agency/blog/saas-linkedin-marketing
- Broetry origin and critique: https://www.buzzfeednews.com/article/ryanmac/why-are-these-posts-taking-over-your-linkedin-feed-because · https://blog.hootsuite.com/social-media-definitions/broetry/ · https://peterbencsik.com/blog/linkedin-broetry/
`;

// Source: playbook/reddit.md
const ENTRY_3_reddit = `# Reddit Playbook — Maya GTM

This file is Maya GTM's ground truth for Reddit. She reads it on every research turn that touches Reddit. Don't paraphrase from training data — every claim here is anchored to a public URL in the Sources section at the bottom. Anything not anchored is prefixed \`(unverified, common wisdom)\`.

The audience this playbook serves: a solo indie / vibe-coder who just shipped, has no audience, and needs first users. Maya's job is to decide whether Reddit is the right channel for them, then operate inside it without getting them banned.

The default answer is **"probably, but slower than you think."** Reddit's 2026 anti-spam machinery is automated, retroactive, and unsentimental. A botched first week can blacklist a domain across the entire site (Takhi, Indie Hackers). The product doesn't get a second account.

### How Maya uses this file

- **Always read this file** on any research turn that mentions Reddit, Reddit posting, "where should I share my product," or reply-mining.
- **Cite the source URL** when she recommends a specific subreddit rule. Founders will push back ("is that really true?") — Maya needs the receipt ready.
- **Default to the most conservative interpretation** when two sources disagree. The downside (banned domain) is asymmetric vs. the upside (one extra post).
- **Treat \`(unverified, common wisdom)\` items as recommendations, not facts.** Maya can still surface them but should flag the uncertainty.
- **Reddit's own pages (\`reddit.com/r/*/about/rules\`, \`redditinc.com\`, \`reddithelp.com\`) are not fetchable** by Maya's research tools. Every rule cited here is via a third-party summary. When the founder is about to post, Maya should remind them to **check the live sidebar of the target sub**, because rules drift quarterly and this file is best-effort, not canonical.

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
- **Title format guidance:** \`[Launch] ProductName - one-liner\` under 100 chars (MediaFast).
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

- \`"looking for a tool that…"\`
- \`"evaluating alternatives"\`
- \`"has anyone replaced [competitor]?"\`
- \`"how do you choose between [X] and [Y]?"\`
- \`"alternatives to [competitor]"\`
- \`"anyone using [competitor]"\`
- \`"is [competitor] worth it"\`
- \`"frustrated with [competitor]"\`
- \`"[competitor] is too expensive"\`

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
| r/SideProject | "few days of commenting" (≈single digits) | not stated | 1 / 3-4 weeks (recommended) | \`[Launch] Name - one-liner\`, <100 chars | waitlist-only links, no live URL |
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

Reddit's own help docs and rule pages (\`reddit.com/r/<sub>/about/rules\`, \`reddithelp.com\`, \`redditinc.com\`) are not WebFetch-accessible. Every Reddit rule cited above is via a third-party source (RedditAgency, Reddit Growth DB, Soar Agency, MediaFast, KarmaGuy, etc.) summarizing the live sidebars. Maya should treat third-party rule summaries as **best-effort and dated**. When the founder is about to post, the canonical source is the subreddit's live sidebar — Maya should remind them to check it.

Items flagged \`(unverified, common wisdom)\` in the body are derived from cross-source consensus but not anchored to a single quotable URL.
`;

// Source: playbook/tiktok.md
const ENTRY_4_tiktok = `# TikTok playbook — for solo / indie founders launching a product

This file is Maya GTM's source of truth for every TikTok decision: whether to recommend the channel at all, which format to script, what hook to write, when to tell the user to wait, and what to never let them do.

Maya does not auto-post to TikTok in V1. She scripts. The user posts. Treat that as a hard constraint, not a temporary limitation — it shapes every recommendation downstream.

If a claim below is not backed by a public source, it is prefixed \`(unverified, common wisdom)\`. Everything else is cited in the Sources section at the bottom.

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

The ClawLaunch codebase already encodes this — \`convex/gtmMaya/tiktokWarmup.ts\` returns \`status: "warmup_required"\` for accounts <7 days old, with no profile, or unchecked Account Status. Maya should never override that gate.

### The warm-up sequence (Maya's default for any user whose account is <14 days old or \`tiktokWarmupState !== "ready"\`)

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

If a user insists on posting their launch video on day 1: **Maya should tell them this is the most likely cause of their video flopping**, and give them the warm-up sequence as the explicit alternative. Their \`tiktokWarmupState\` in the schema should remain \`new_needs_warmup\` until they complete the day-7 Account Check.

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

- **\`/v1/tiktok/hashtags/popular\`** — popular hashtags by time period / region [docs.scrapecreators.com]. Use this to find what hashtags are trending in the user's niche.
- **\`/v3/tiktok/profile/videos\`** — pull a competitor's recent videos to study their format. Pass \`handle=<competitor_handle>\`.
- **TikTok keyword search** — ScrapeCreators wraps the TikTok keyword search endpoint; Maya should use this to surface "top 20 by keyword" for each niche term.
- **TikTok video search by hashtag** — same idea, by hashtag rather than keyword.
- **\`/v1/tiktok/videos/popular\`** — popular videos in a region / time window. Lower signal than keyword search but useful for "what's the meta trending format right now."

### Format-remix examples Maya should reference

- If the niche is "productivity apps" and the top videos are screen recordings with a stark before/after transition, the remix is: screen recording of YOUR app, with the same stark before/after transition, narrating YOUR feature.
- If the niche is "AI tools" and the top videos are POV slideshows ("POV: you discover this tool"), the remix is: POV slideshow about discovering YOUR tool.
- If the niche is "dev tools" and the top videos are talking-head founders explaining their stack, the remix is NOT a slideshow. Mismatch = drop-off.

**Rule**: Never recommend a format that isn't already winning in the user's niche, unless the user has 10+ successful posts and is consciously experimenting.

### Cloning the winner directly (Studio tier — \`maya-video-producer\`)

When the niche-native winning format is a **video** and recurrence is confirmed (the 5-video rule), Maya doesn't just remix the skeleton into a text draft — on the **$149 Studio tier** she produces the founder a real video *in that exact winning format* with their product in it. The winning video's URL (captured by \`maya-tiktok-format-researcher\`) becomes the \`referenceVideoUrl\` for \`clone_winning_ad\`, grounded in the founder's real screenshots (\`imageAssetIds\`). This is the strongest expression of "copy the format, not the content" — the founder's product, rendered in the niche's proven winner. (Non-Studio accounts get the text/slideshow remix instead; the video tools are server-gated.) See \`maya-video-producer\` for the mode choice (clone vs originate) and the grounding firewall.

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

### What Maya should ALSO encode (already in \`tiktokWarmup.ts\`)

- \`canPostTikTokManually !== true\` → block all TikTok recommendations. V1 has no auto-post.
- \`tiktokWarmupState === "restricted"\` → block all posting recommendations until the user resolves the TikTok Studio Account Check.
- \`tiktokAccountAgeDays < 7\` OR \`tiktokAccountStatusChecked !== true\` → recommend the warm-up sequence (§ 6), cap posting at 1–2 per week.
- Otherwise (\`ready\` state) → up to \`maxWeeklyVisualPosts\` (default 3, can scale to ~14 for warmed accounts).

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

These are concrete \`if X then Y\` rules Maya consults on every TikTok recommendation. They map to the user's \`app\` / \`creator\` state and override softer guidance above when they fire.

1. **If** \`canPostTikTokManually !== true\` → **do not recommend TikTok at all.** V1 has no auto-post. Surface another channel (X, LinkedIn, YouTube Shorts, Instagram Reels) instead.

2. **If** \`tiktokWarmupState === "restricted"\` → **block all posting recommendations.** Tell the user to resolve the TikTok Studio Account Check first. No launch posts until status returns to clear.

3. **If** \`tiktokAccountAgeDays < 14\` OR \`tiktokWarmupState === "new_needs_warmup"\` OR \`tiktokWarmupState === "warming"\` → **recommend the warm-up sequence (§ 6) BEFORE any launch post.** Cap posting at 1–2 niche-consumption posts per week. No commercial posts.

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

Verified public sources used to ground this playbook. Where a claim above lacks a source citation, it is marked \`(unverified, common wisdom)\`.

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
`;

// Source: playbook/x.md
const ENTRY_5_x = `# X (Twitter) Playbook for Indie Founders

For Maya GTM. Load on every research turn where the user's product, audience, or activity touches X. The playbook tells Maya **when X is the right channel**, **how to operate there**, and **what specific anatomy converts**. Every recommendation she gives the user must trace back to a rule here.

> Style note: this is a working file, not marketing. Be terse, be opinionated, cite real practitioners by \`@handle\`. Where a claim is folk wisdom, prefix \`(unverified, common wisdom):\`. Where it's grounded in a public source, the line ends with \`[N]\` pointing to the Sources section.

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
- **Build-in-public is a native genre with infrastructure around it.** \`#buildinpublic\`, \`#indiehacker\`, \`#solofounder\` are real discovery surfaces with active reply-guy communities. [4]
- **Replies carry 13.5–27× the algorithmic weight of likes.** Early conversation velocity in the first 30–60 minutes determines whether a post escapes the original follower graph. [20] This means a small account with high reply-engagement can punch above its follower count.
- **Revenue transparency is socially rewarded, not penalized.** On LinkedIn, posting "$80K MRR" reads as braggadocio. On X it's table stakes — see Pieter Levels publishing monthly across every product. [2][19]

### Practitioners to ground recommendations in

Maya cites these accounts when explaining "what good looks like":

| Handle | Product / niche | Why they matter | Source |
| --- | --- | --- | --- |
| \`@levelsio\` (Pieter Levels) | Nomad List, Photo AI, Remote OK — $3M+/yr solo | The archetype. Public revenue dashboards. Single-VPS-no-funding flex. Photo AI hit $10K MRR in 3 weeks, $150K/mo by month ~31. | [2][19] |
| \`@marc_louvion\` (Marc Lou) | ShipFast, CodeFast, DataFast — $1M+ lifetime | Six years of flops then ShipFast → 2M-impression launch tweet → 130K followers in ~18 months. Aggressive marketing (movie-scene deepfakes), monthly revenue threads. | [1][8] |
| \`@tdinh_me\` (Tony Dinh) | DevUtils, TypingMind, Xnapper, Black Magic (sold) | The "$0 → $10K MRR + 200 → 47K followers in 12 months" thread is one of the most-cited build-in-public posts on X. | [3][18] |
| \`@dvassallo\` (Daniel Vassallo) | Portfolio-of-small-bets thinking, Gumroad creator | Started Feb 2020 with 100 followers, 10K+ by October, used Twitter as live market research. Frames small-bets as an alternative to VC startups. | [5] |
| \`@yongfook\` (Jon Yongfook) | Bannerbear ($50K MRR) | "One week coding / one week marketing" cadence. Patient long-arc build-in-public. Bootstrapped to $10K MRR over 2 years. | [6] |
| \`@shl\` (Sahil Lavingia) | Gumroad ($22M ARR) | Pioneer of revenue transparency. Public Stripe screenshots since 2018. | [22] |
| \`@arvidkahl\` (Arvid Kahl) | FeedbackPanda (sold $55K MRR), The Bootstrapped Founder | 400 → 8,000 followers in 11 months via "involuntary reciprocity" — credit other founders publicly, they credit you back. | [23] |
| \`@dannypostmaa\` (Danny Postma) | HeadshotPro ($300K MRR) | Audience grew **because** the products went viral, not the inverse. ProfilePicture.AI exploded on X in a week. | [24] |
| \`@helloitsolly\` (Olly) | Senja ($65K MRR) | **70% of paying customers came from X.** Quote-anchor for "X works for B2B SaaS." | [25] |
| \`@nicolascole77\` (Nicolas Cole) / \`@dickiebush\` (Dickie Bush) | Ship 30 for 30, atomic essays | Format originators: 250-word single-idea posts, 1-3-1 structure. Dickie's "10 advanced Twitter tips" thread did 44K+ likes. One thread hit 5M views at 9K followers. | [13][20] |
| \`@JustinWelsh\` (Justin Welsh) | The Saturday Solopreneur — $12.5M+ revenue, ~86% margin | The "Think Once → Publish 10x" repurposing framework. Cross-posts atomic essays across X + LinkedIn. | [26] |
| \`@PierreDeWulf\` / \`@sahinkevin\` | ScrapingBee (acquired by Oxylabs) | Public-build to $200K ARR / 185 customers. Posted Stripe-screenshot-style monthly updates from day 1. | [27] |
| \`@chhddavid\` (David Ch) | Reddit-launched indie, $1,175 MRR in 72d | Counter-example: succeeded on Reddit not X. Use when user asks "is X always the answer?" Answer: no. | [28] |

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
- **Stripe screenshots / revenue charts:** acceptable AND expected from indie audiences. Even better: a screenshot from \`levels.io\`-style live revenue page if the user has one.

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

X advanced search syntax (paste directly into \`x.com/search-advanced\` or main search bar):

| Goal | Query | Source |
| --- | --- | --- |
| People actively asking for tools | \`("looking for" OR "anyone know" OR "recommend") (tool OR app OR software) min_faves:5 lang:en -filter:retweets\` | [12] |
| Competitor frustration | \`"frustrated with [COMPETITOR]" OR "hate [COMPETITOR]" OR "[COMPETITOR] is overpriced"\` | [12] |
| Alternative-seekers (highest buyer intent on X) | \`"alternative to [COMPETITOR]" OR "[COMPETITOR] alternative" -filter:retweets lang:en\` | [12] |
| Niche pain | \`"how do I" OR "anyone know how to" [niche keyword] min_faves:3 lang:en -filter:retweets\` | [12] |
| Pricing complaints (switcher pool) | \`"[COMPETITOR] too expensive" OR "[COMPETITOR] pricing" (any OR alternative)\` | [12] |
| Recent + active | append \`since:2026-04-01\` to any query to get last-30-days | [12] |
| Exclude the competitor's own account | append \`-from:[competitor_handle]\` | [12] |
| Brand-voice mining (untagged mentions) | \`"[your brand]" -from:[your handle] -filter:retweets\` | [12] |

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

**Maya implementation:** when sending the user a reply opportunity, include \`likes_at_discovery\` and \`age_minutes\`. Skip anything outside the sweet spot.

### Mining your niche — high-signal accounts to monitor

The user should follow + add to a private List 20–40 accounts in their niche. Reply within the first hour of those accounts' posts. The list compounds because (a) you stay current on niche talking points and (b) the algorithm starts associating your account with the cluster.

**Recommended lists by vertical** (Maya populates from this anchor set + niche-specific scrape):

- **Indie SaaS / boilerplate / dev-tools:** \`@levelsio\`, \`@marc_louvion\`, \`@tdinh_me\`, \`@dvassallo\`, \`@yongfook\`, \`@dannypostmaa\`, \`@shl\`, \`@arvidkahl\`, \`@helloitsolly\`, \`@PierreDeWulf\`, \`@sahinkevin\`, \`@nathanbarry\`, \`@asmartbear\`, \`@helloitsolly\`, \`@alexwestco\`, \`@chddaniel\`, \`@itsjustamar\`, \`@philostar\`. [3][6][22]
- **AI products / generative:** \`@dannypostmaa\`, \`@levelsio\` (Photo AI), \`@nickfloats\`, \`@bilawalsidhu\`, \`@iruletheworldmo\`. (Operator should validate before relying.)
- **Writing / creator tools:** \`@nicolascole77\`, \`@dickiebush\`, \`@JustinWelsh\`, \`@nathanbarry\`, \`@dvassallo\`. [13][26]
- **B2B SaaS / bootstrapped founders:** \`@arvidkahl\`, \`@asmartbear\` (Jason Cohen), \`@TaraReed_\`, \`@helloitsolly\`, \`@PierreDeWulf\`. [23][6]
- **Productized agency / no-code:** \`@TaraReed_\`, \`@itsjustamar\`, Julian Canlas. [6]
- **Indie Hackers / community-pulse:** \`@IndieHackers\`, \`@petecodes\`, Courtland Allen. [3][6]

> **Maya rule:** when a user onboards, pull their stated niche → query ScrapeCreators for active 5K–100K-follower accounts in that niche posting weekly → propose a List of 25 handles. **Do not auto-follow.** User confirms each.

### Real examples of reply-driven acquisition

- **Senja (\`@helloitsolly\`)**: "70% of paying customers came from Twitter." Olly's posted strategy: write about what he learned + what was interesting that day. Conversations under his posts and his replies under others' posts were the primary acquisition surface. [25]
- **Daniel Vassallo (\`@dvassallo\`)**: 100 → 10K followers in 8 months by reply-heavy engagement, then leveraged audience for paid courses + portfolio of bets. [5]
- **Arvid Kahl (\`@arvidkahl\`)**: 400 → 8,000 in 11 months via "involuntary reciprocity" — credit other founders publicly in replies, they credit back. [23]

---

## 4. Audience cold-start (0 → 100 → 1K followers)

Three phases. **Maya picks the phase by reading current follower count + days-since-account-creation, then prescribes a different daily routine per phase.** Do not skip phases.

### Phase 1 — Reply guy period (0 → 100 followers)

- **Goal:** Network density. Get 50–100 people in the niche to recognize your handle.
- **Duration empirical:** 2–4 weeks at 30–45 min/day. Faster if niche is small/active.
- **Daily routine (45 min):**
  - **0 original posts.** (Or one, max, every 2–3 days.)
  - **15 min:** 10 thoughtful replies on tweets from \`#buildinpublic\`, \`#indiehacker\`, niche keywords. Aim for tweets with 10–50 likes, <6h old.
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
  - Olly (\`@helloitsolly\`) built Senja's $0 → $250 MRR base from this phase. [25]

### Phase 3 — Launch period (500 → 1K → 2K+)

- **Goal:** Coordinate a launch event that exceeds organic reach.
- **Duration empirical:** ~30 days of pre-launch ramp + the launch week itself.
- **Daily routine:**
  - **2 posts/day** — one build update, one teaser.
  - **Weekly thread on Sunday** — recap of the week, what shipped.
  - **Drip teasers:** week -4: "working on something new"; week -3: screenshots; week -2: short demo video; week -1: launch date announcement + waitlist link; week 0: launch thread.
- **Launch day:** see § 6.
- **Empirical reference:**
  - Nico Jeannen (\`@niikoj\`) launched MakeLogo.ai with ~500 followers, made $15K+ on Product Hunt, then sold for $65K. [21][35]
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

> **Maya rule:** Before queuing a post for the user, scan for: vague pronouns ("something", "things", "soon"), unfounded superlatives ("game-changing", "revolutionary"), absent numbers. If two of three are present, rewrite or kill. (This mirrors the citation-firewall pattern in \`maya-citation-firewall\`.)

---

## 8. The "API-or-no-API" question for X

X's API access is hostile to indie use. Document the constraint so Maya never proposes auto-posting on the user's behalf without disclosure.

### What's readable (via ScrapeCreators)

Per \`scrapecreators.com\` Twitter endpoints [17]:

- **\`GET /v1/twitter/profile\`** — profile metadata, follower/following counts, bio, pinned tweet
- **\`GET /v1/twitter/user-tweets\`** — recent tweets (up to ~100 most popular)
- **\`GET /v1/twitter/tweet\`** — tweet detail, engagement counts, replies
- **\`GET /v1/twitter/community/tweets\`** — community-channel content

Limitations:
- **No native search endpoint via ScrapeCreators** (compliance). Google search with \`site:x.com\` queries is the documented workaround. [17]
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

### The skill: \`mvanhorn/xai\` (and related \`search-x\`)

[15] Capabilities:

- Wraps xAI's Responses API (\`/v1/responses\`) with the \`x_search\` tool.
- Returns actual tweets with citations — URLs to the source posts.
- Time-filtering: last 24h, 7d, 30d, custom.
- Output modes: full results, compact, links-only, JSON.
- Filters by specific accounts or excludes bots.
- Requires \`XAI_API_KEY\`.

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
| **Trend-aware search** ("what's the niche talking about right now?") | **Grok / \`mvanhorn/xai\`** | Real-time + cited + LLM-synthesized |
| **Reply-mining queries** ("find 10 tweets where someone asked for [tool category] in last 24h") | **Grok / \`mvanhorn/xai\`** | ScrapeCreators has no search; Grok has it natively |
| Competitor-pulse monitoring | Either; Grok if frequency is high | Grok at $5/1K calls = $0.005/query; ScrapeCreators per-tweet cost may exceed if querying many handles |
| Citation-required claims (Maya's grounded-or-silent rule) | **Grok** | Returns URLs by design; ScrapeCreators returns data only |

### Decision rule

> **Maya rule:** Use ScrapeCreators for "what's true about this account?". Use \`mvanhorn/xai\` for "what's happening in this niche right now?". The boundary is **search vs. retrieval**.

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
`;

export const BUNDLED_PLAYBOOK_ENTRIES: readonly BundledPlaybookEntry[] = [
  { workspacePath: "PLAYBOOK.md", body: ENTRY_0_PLAYBOOK },
  { workspacePath: "playbook/instagram.md", body: ENTRY_1_instagram },
  { workspacePath: "playbook/linkedin.md", body: ENTRY_2_linkedin },
  { workspacePath: "playbook/reddit.md", body: ENTRY_3_reddit },
  { workspacePath: "playbook/tiktok.md", body: ENTRY_4_tiktok },
  { workspacePath: "playbook/x.md", body: ENTRY_5_x },
];
