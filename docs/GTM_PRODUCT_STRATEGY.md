# GTM Product Strategy — ClawLaunch / Maya (source of truth)

_Locked 2026-06-01. Supersedes scattered decisions in prior handoffs. If a future
suggestion contradicts this doc, default to the doc unless the operator revises it._

---

## 1. What it is (one line)

**"Maya gets your app customers — and proves it."**

A single-agent AI growth manager for solo founders who just shipped a product and
need customers. The founder builds; Maya goes out and gets users, on a daily cadence,
in the founder's voice, from the founder's phone — and proves which post drove which
signup.

Positioning: **"Find your buyers. Market while you sleep. Prove what converted."**

The relationship we're building: _you make the product, Maya gets the customers._

---

## 2. ICP

The **AI-native solo founder** — ships a real SaaS/app fast, has commercial intent,
can't/won't market, has no audience. NOT the hobbyist (filtered by card-required
paywall, once billing lands).

- Real paying target = the ~18% who **monetize** (>$1K/mo). A builder earning <$500/mo
  won't durably pay.
- **Mobile-app makers are the marketing wedge** (sharpest pain, cleanest visual fit,
  store screenshots auto-grabbable) — but architecture stays **mobile + web**. Don't
  fence out higher-WTP web/B2B SaaS founders, where the validated WTP actually lives.
- **No-video reality:** until visual content ships, we serve the **web/B2B SaaS founder
  best** (Reddit/X/HN + attribution). The mobile wedge becomes fully servable when
  slideshow/video content lands. Narrow the marketing, build one notch wider.

---

## 3. Moats vs commodity

**Moats (what we win on — market these, never gate them):**
1. **Video/visual-outbound discovery** — find buyers in the *comments* of TikTok/IG/YT
   videos; text-only competitors can't follow them there.
2. **Closed-loop attribution** — prove the signup/install. No funded competitor does
   this; all stop at vanity/intent metrics. = retention.
3. **Ban-safety / account-health** — human-approved posting; reframe from "auto-post
   safe" to "account-health." = anti-churn.

**Commodity (do cheaply, demote in messaging):** content creation, drafting,
voice-match, scheduling, "every channel" (commoditizing table-stakes).

The binding constraint on this business is **WTP / retention, not market size**
(~$1–5M ARR indie business, not a venture rocket). So the moats — attribution and
ban-safety — are the whole game.

---

## 4. Channels (MVP set + mode)

| Channel | MVP status | Notes |
|---|---|---|
| Reddit | ✅ Full — do-it + prove-it | Working researcher + engagement skills; links clickable → attribution closes |
| X (Twitter) | ✅ Full — do-it + prove-it | Working; links clickable → attribution closes |
| Hacker News | ✅ Full — do-it + prove-it | Working; links clickable → attribution closes |
| LinkedIn | ✅ Built (secondary) | Working researcher; founder-led motion |
| TikTok | 🟡 Brief-mode (MVP) → slideshow (fast-follow) | No clickable links → reach channel, not attribution channel |
| Instagram | 🟡 Brief-mode (MVP) → slideshow (fast-follow) | No dedicated researcher yet; reach channel, not attribution channel |
| YouTube | ❌ Removed from MVP | No native slideshow format; worst cold-start of the majors; revive only with real video |
| Product Hunt | ❌ Removed | Vestigial schema entry; no researcher skill |

**Attribution backbone = Reddit / X / HN** (clickable links). TikTok/IG are
**reach / be-everywhere-your-buyers-are** channels — do NOT sell them under the
"prove it" moat; their attribution is link-in-bio only.

---

## 5. Content model

### Comfort ladder (onboarding — default hands-off, never a gate)
Captured once. Higher rungs *unlock* better formats; they're never the price of entry.

1. **"Just handle it" (default)** → Maya makes faceless image slideshows from the
   founder's real screenshots.
2. **"I'll record my screen sometimes"** → richer clips around a quick screen capture.
3. **"I'm happy to be on camera"** → Maya hands a ready-to-film script + caption + shots.

(The onboarding already captures these as toggles: record-screen / voiceover /
show-face / provide-screenshots / can-post-TikTok / can-post-IG + walkthrough upload.)

### Visual content rule (GROUNDED OR SILENT, extended to images)
- **Real screenshots / screen-recording frames are the substance — the actual UI is
  always real.**
- **Gemini 2.5 Flash Image ("nano banana")** generates only the *frame around* the
  real asset: hook/caption cards, branded backgrounds, device mockups, contextual /
  lifestyle slides — conditioned on the real screenshot for style. **It never invents
  app screens and presents them as the product UI.**
- **Asset-request flow — judgment-driven, never a rigid step.** Maya does NOT pre-ask
  for screenshots at onboarding, and never double-asks. While planning a post that would
  land better with a visual, she **searches her own asset store first** (`search_my_media`)
  and only if she's missing what she needs does she text the user for that specific thing
  (`request_media`): _"making your TikTok carousel today — can you send me your dashboard
  screen?"_ → user texts it → ingested into `gtmMediaAssets` → reused next time. The store
  fills over time, so she asks less. Onboarding may *accept* offered screenshots, but the
  proactive ask is contextual, in-the-moment, and once.

### Posting reality
- **Making** a slideshow is cheap and near-term.
- **Auto-posting** to TikTok/IG needs the TikTok Content Posting API + Instagram Graph
  API (business accounts + app review — days/weeks of approval, not code). Until
  approved: Maya assembles the slideshow and sends it to the founder to post in one tap.
  Auto-post is fast-follow.

---

## 6. Architecture (already built — do not rebuild)

- **Foundation research** (once after onboarding, then monthly refresh): the durable,
  rich picture — ICP, buyer map, competitive map, per-platform briefs, channel
  scorecard, content angles, relationship targets.
- **Continuous research** (daily, when last pass >6h old): per-channel workers mine new
  target threads, competitor moves, niche-pulse signals.
- **7am morning brief**: reads the foundation + fresh signals → proposes **today's**
  plan (specific comments/posts). NOT a pre-baked week — Reddit/X/HN move in real time;
  catch threads before they peak; feed yesterday's attribution into today.
- **~1–2pm midday pulse (NEW)**: a *light* velocity sweep of the 1–2 bet channels for
  fresh hot strikes that appeared since the morning brief. Found → **ADD** to today's
  calendar (never replace) + one one-tap ping. Silent if nothing's hot. This is the
  "something's blowing up right now, hop on it" lane. Discovery is the crons' job;
  the heartbeat only reminds + monitors own posts, it does not re-sweep for new threads.
- **8pm evening recap** (now also surfaces attribution) + **Sunday weekly review** +
  **monthly foundation refresh.**
- The foundation builds a first *starting* week at onboarding (immediate value); the
  daily crons refresh/override it day-by-day. It's a living week, not a fixed one.
- Delivery: **per-operator Telegram bot** (BotFather token, encrypted, isolated webhook
  per Fly machine). Shared bot is test-only.

---

## 7. Attribution

Built: `wrap_link` → `/r/<token>` redirect (logs click + UTM, 302s) → `record_conversion`
(self-report or pixel) → per-post dashboard at `/clawlaunch/mission/results`.

**Gap to close for MVP:** Maya does not yet *proactively surface* attribution in
Telegram. Morning brief / evening recap must report per-post clicks + conversions
("your r/SaaS reply got 14 clicks → 2 signups"). This is the differentiator made
visible — the single most important MVP build.

---

## 8. Pricing / tiers

- **MVP: no tiers, no paywall.** Pilots-first — hand-pick 3–5 founders, eat the COGS,
  validate the loop is lovable. Spend caps ($2/day, $35/mo) already protect COGS.
- **After pilots prove people pay:** single price → then a two-tier split. Future axis
  = **done-for-you visual content**: base = drafts + Briefs; paid = Maya makes & posts
  the slideshows (then video as premium / Studio).
- Implement via `planFeaturesGtm` (does not exist yet), server-side fail-closed. Moats
  (attribution, ban-safety, voice) are NEVER gated.

---

## 9. Build sequence

**Tomorrow (pilot-ready — the core loop, live):**
1. Reddit/X/HN core loop (built; live-verify).
2. **Attribution surfacing in Telegram** (morning brief + evening recap). ← main build.
3. Picker cleanup: remove YouTube + Product Hunt.
4. TikTok/IG = Brief-mode (kept selectable).
5. One live end-to-end run on operator infra. ← the real gate; needs operator keys.

**Fast-follow (days):**
6. Slideshow generation: nano-banana integration + assembly from real screenshots +
   asset-request flow in the daily plan.
7. TikTok/IG auto-posting (pending API approvals).
8. Instagram researcher parity.
9. Stripe + `planFeaturesGtm` + the tier split (after pilots validate).

---

## 10. What this product is NOT
- Not a content scheduler — Maya advises/drafts/assembles; founder approves.
- Not a vanity-metrics tool — the point is provable conversions.
- Not credits-metered — flat, capped chat / unlimited proactive (when billing lands).
- Not a fabricated-content tool — real screenshots only; no hallucinated UI.
