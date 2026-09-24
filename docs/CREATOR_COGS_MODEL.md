# Maya creator COGS model

**Date:** 2026-09-23 · **Model:** `scripts/cogs/model.py` (re-run it whenever a price or frequency changes; every number below comes from it)
**Covers:** every vendor the creator product calls plus the planned additions: world search (Tavily), the diagnosis brain (B-sprints), the companion app, and the share extension.

## 1. Headline

At **typical usage**, blended over a 50% solo / 30% duo / 20% partner mix:

| Creators | Blended gross margin, today's settings | With the four cheap levers (§6) |
|---|---|---|
| 50 | **negative** (fixed costs and one messaging line on 50 people) | still negative |
| 200 | **38%** | **~47%** |
| 1,000 | **50%** | **~59%** |

- **Solo at $19 is the weakest tier:** 33% margin at 200 creators, 46% at 1,000. Solo gets the same brain and the same messaging as duo for $6 less.
- **The worst-case ceiling is broken.** The proactive spend cap is `dailyUsdCap: 0.75` (`convex/config/thresholds.ts`), which works out to **$22.50 a month**, more than the solo price. Replies are uncapped by design. One heavy user on solo can cost more than they pay.
- **This is lower than the 57–75% in the July note.** That note predates the phone number (Claw), the Stripe fee stack, and scraping for the lane watcher at today's pack price.

## 2. How this was built, and how sure it is

| Input | Source | Confidence |
|---|---|---|
| Cost per model call | **Measured**: the creator dev ledger (`costEvents`), 3,905 rows, 2026-09-02 → 09-23, OpenRouter-reported | High for unit costs. The rows are almost all eval runs, so there are **no real customer-months yet** |
| ScrapeCreators $/credit | $47 / 25k = $0.00188 (the code's constant); the $497 / 500k pack = $0.00099 | High (vendor site, Sep 2026) |
| Tavily | $0.008 per basic search | High (already the code's constant, and matches the Sep 2026 price) |
| Claw (iMessage) | Agency plan: $199/line/month + $250 onboarding, 1,000 msgs included, $0.005/msg after | Medium. Prices are public; **how many recipients one line may serve is not** (see §5) |
| Zernio | Graduated per connected account: 1–2 free, 3–10 $6, 11–100 $3, 101–2,000 $1 | Medium. Verified 2026-07-02; whether bands are graduated or all-units is assumed graduated |
| OpenRouter fee | 5.5% on card top-ups | High |
| Stripe | 2.9% + $0.30 per charge, + 0.7% Billing | High |
| OpenRouter list prices | **Not re-verified today.** The API reset every connection from this machine, so the model uses **actual billed cost per call from the ledger** instead | Measured beats list, but re-check list prices before any model change |
| How often things happen per creator | **Assumed**, with light / typical / heavy profiles named in the script | **Low: the biggest source of error.** Replace with pilot data (§7) |

## 3. Measured unit costs

| Operation | Model | $ per call | Tokens per call |
|---|---|---|---|
| Reply (converse) | gemini-3.7-flash | 0.0079 | 10,958 |
| Reply rewrite after the critic rejects | gemini-3.7-flash | 0.0094 | 9,487 |
| **Critic rejection rate on replies** | — | **32%** (213 of 661) | — |
| Scout daily pass | gemini-3.7-flash | 0.0106 | 18,586 |
| Weekly review | gemini-3.7-flash | 0.0156 | 13,674 |
| Weekly learning | gemini-3.7-flash | 0.0209 | 13,049 |
| Classify, critic, remember, eval judge | glm-5.3-flash / deepseek-v4-flash | 0.0002–0.0004 | 1–3k |
| Watch one of their own posts | gemini (direct) | 0.0048 | — |
| Storyboard frames (suppressed) | gemini-3.1-flash-image | 0.055 | — |
| Onboarding, one-time | mixed | 0.35 | — |

A reply costs about **$0.016 all-in** once you add classify, critic, memory, the eval judge, a 32% rewrite, and about 2 lookup credits. Replies send about 11k tokens of prompt every turn, which is why prompt caching is a big lever.

## 4. Per creator per month, typical duo (after the B-sprints and the app)

| Line | $ / month |
|---|---|
| Scout daily pass (model + ~15 credits a day) | 1.27 |
| Lane watching (6 accounts × every 6 h) | 1.08 |
| Replies (60 a month) | 0.94 |
| Diagnoses: why it popped or flopped (6 a month, incl. Tavily) | 0.55 |
| Own posts readback + watching them | 0.48 |
| Opinions on links and drafts (incl. share extension) | 0.45 |
| Lane keyword sweep | 0.32 |
| Taste, morning line, cadence | 0.29 |
| Weekly review + learning | 0.23 |
| OpenRouter 5.5% fee | 0.25 |
| Other (moments, memory) | 0.09 |
| **Variable brain + data** | **5.94** |
| Zernio (2 accounts; $1.73 per account at 200 creators) | 3.46 |
| Messaging (Claw; 210 messages a month; one line at 200 creators) | 2.02 |
| Stripe ($24.99) | 1.20 |
| Platform fixed, shared (§4.1) at 200 creators | 1.52 |
| Trial users who never convert (onboarding + 7 days, at ~60% conversion) | 0.80 |
| Onboarding, amortised over ~8 months | 0.04 |
| **Total at 200 creators** | **~14.98 → 40% margin on $24.99** |

Variable cost by usage profile (brain + data only, after the B-sprints):

| | Light | Typical | Heavy |
|---|---|---|---|
| Solo | $3.84 | $5.69 | $12.12 |
| Duo | $3.99 | $5.94 | $12.63 |
| Partner | $4.73 | $6.69 | $13.37 |

The B-sprints and the app add about **$0.75 per creator per month** (diagnoses, world search, share-extension opinions). That's cheap for what it buys.

### 4.1 Fixed platform costs ($ / month)

Convex Pro + usage ~65 · Vercel Pro 20 · Clerk Pro 25 · Fly (claw relay) 5 · Sentry 26 · EAS 19 · Apple Developer 8 · domain and email 10 · **Google CASA security assessment for Gmail's restricted scope, needed for partnerships: ~$125** (roughly $1.5k a year, recurring). **Total ≈ $300 a month.** That's $6 per creator at 50, $1.52 at 200, and $0.30 at 1,000.

**Zapier:** nothing in the code calls it, on any branch. If you use it outside the codebase, tell me what for and it goes into §4.1.

## 5. The unknowns that move the answer most

1. **How many people one Claw line may text.** The self-serve plan caps registered recipients at 50. If the agency plan does too, 200 creators need 4 lines, and messaging goes from **$2.02 to $4.93 per creator**, a 12-point margin swing. Apple's spam heuristics also push toward more lines. **Ask Claw this in writing before anything else.** Alternatives to price: Linq direct (quote-only), Twilio SMS/RCS ($0.0083/msg ≈ $1.75 per creator, no line fee, but no iMessage blue bubble).
2. **Real usage.** Every frequency is assumed. The first 10 paying creators replace them (§7).
3. **Zernio band semantics** (graduated vs all-units). At 200 creators that's $1.73 vs $1.00 per account.
4. **Whether Zernio is needed for solo.** Solo users' public numbers come from ScrapeCreators anyway. Zernio adds connected reach and retention. Keeping it is right for accuracy, but it's the second-biggest line.

### 5.1 The messaging vendor: Claw vs the alternatives

**Claw is a reseller of Linq.** It's a relay (Render/Supabase/Vercel) in front of Linq's iMessage fleet, run by a solo founder largely through an AI agent, at about $1.1k MRR. It has no SLA, stores message bodies, and its outbound media support is undocumented. Fine for a pilot. Not what you want carrying the product at 200+ creators.

| Option | What it is | Reliability | Cost shape | Verdict |
|---|---|---|---|---|
| **Linq, direct** | The fleet Claw resells | SOC 2 Type II, **99.95% SLA**, deletes message bodies every 24 h, ~7,000 msgs/line/day | Quote-only (~$500+ setup, per line) | **Recommended once past the pilot.** Same blue bubble, no middleman, a contract with an SLA |
| Sendblue | Established iMessage API | Mature; the outbound-first plan is enterprise | ~$100/line replies-only; outbound-first ~$1k/line | Too expensive for proactive-first Maya |
| Blooio, LoopMessage | Smaller resellers | Unproven at our scale | ~$39/line (Blooio) | Not better than Claw on the risk that matters |
| Twilio RCS / SMS | Official carrier messaging | High, official, verified sender | $0.0083/msg (≈ $1.75 per creator), no line fee, 4–6 weeks of registration | **Fallback lane.** Green bubble on iPhone, but official and ban-proof |
| Apple Messages for Business | Apple's official lane | Official, no ban risk | Via an Apple-approved provider; needs Apple review (Poke was the first AI agent approved, June 2026), AI labelling, human support | **The long-term lane.** Worth applying for once there's traction |

**The structural risk isn't the vendor.** Every iMessage reseller runs real Apple IDs on Apple hardware, which is a grey area with Apple, and the ban risk comes with the lane itself (Lindy's own-Mac ban, 2026). So:
1. Keep the transport behind the one writer (`messages.send` → `deliverMessage`, already built that way).
2. **Add a second provider for failover** (Twilio SMS/RCS) so a flagged line degrades to a green bubble instead of silence.
3. Enforce the outbound:inbound ratio rail already recommended in the messaging research.
4. Move from Claw to **Linq direct** before ~100 creators, and start the Apple Messages for Business application in parallel.

Cost: Linq direct is likely similar to or cheaper than Claw per creator at scale (no reseller margin), but it's quote-only. Get the quote with the recipients-per-line question (§5.1) answered in writing.

## 6. Levers, in order of effort

| Lever | Effect at 1,000 creators | Effort |
|---|---|---|
| **Fix the caps first:** proactive `dailyUsdCap` 0.75 → **0.30**, plus a monthly reply allowance that **drops to a cheaper model instead of refusing** (the standing rule: caps throttle, they never destroy) | Bounds the worst case at about $9 + replies instead of $22.50 + replies | 1 day |
| Buy the **500k ScrapeCreators pack** ($497) | +7 points blended | Money only |
| **Prompt caching** on reply and scout prompts (~11–18k tokens of mostly stable prefix) | +2 points, if caching cuts the writer ~35% (measure it) | 1–2 days |
| **Cut critic rejections from 32% to ~10%** by fixing what the critic keeps rejecting upstream in the prompt | Saves ~$0.20 per creator (~+1 point) and makes replies faster | Diagnose from critic rows |
| **Adaptive lane watching:** sample accounts that posted in the last 48 h every 6 h, the rest every 24 h | ~$0.50 per creator | 1 day |
| **Annual plans** (already priced at 10× monthly) | Stripe's $0.30 is charged once a year instead of 12 times | Exists; promote it |
| **Solo price $19 → $24** (and duo stays $24.99 or moves up) | Solo margin +13 points at 200 creators (33% → 46%) | Your call |

With the first four levers applied: **~47% at 200 creators, ~59% at 1,000.** Adding adaptive watching and a settled messaging contract should push past 60% at 1,000. **To clear 60% at 200 creators, solo pricing or messaging has to change.**

## 7. Making COGS live, not a spreadsheet

The /ops COGS panel (`convex/ops.ts metrics`) today sees only the ledger (models, ScrapeCreators, Gemini, Tavily). It **misses messaging, Zernio, Stripe, and fixed costs**, and it **counts eval runs as customer spend** (every row on dev is tagged `environment: "local"`, and most spend belongs to eval creators). Build before the first paying creator:

1. **Exclude eval and scenario creators** (`clerkUserId` starting with `eval`) from per-creator COGS.
2. **Ledger rows for Claw** (per message, at the plan's marginal rate; the `claw` vendor already exists in the schema) and **a monthly Zernio row per connected account**.
3. **Stripe fees from the webhook** (the charge's balance transaction carries the fee).
4. **A fixed-cost table in config**, amortised per paying creator on /ops.
5. **OpenRouter reconciliation** alongside the existing ScrapeCreators one (`core/reconcile.ts`): the key's usage against the ledger, a daily alert beyond 10%.
6. **Per-creator margin on /ops**, with a list of creators below 30%, so a heavy user is seen within a day, not at month's end.

Re-run `scripts/cogs/model.py` with the pilot's real frequencies after 30 days of 10 paying creators, and replace every "assumed" row in §2.

## 8. Decisions for the operator

1. **Ask Linq directly (and Claw)** for the recipients-per-line limit and a written quote at 200 and 1,000 creators. It's the largest unknown, and Linq direct is the likely destination (§5.1).
2. **Approve the cap change** (proactive $0.30 a day, with replies degrading instead of refusing).
3. **Buy the 500k ScrapeCreators pack** once the pilot starts spending.
4. **Solo pricing:** keep $19 and accept ~40–55% margins on solo, or move it to $24.
5. **Zapier:** confirm whether anything outside the repo uses it.
