# R1 — Unified social/GBP/FB/IG API landscape (2026-04-27)

Scope: identify the developer surface(s) HeyMaya should use to give Maya write + read + webhook access to Google Business Profile (GBP), Facebook Pages, Instagram Business, plus secondary platforms (TikTok, LinkedIn, Yelp, Trustpilot, Apple Maps Connect) on behalf of service-business operators (HVAC, plumbing, landscaping, contractors).

---

## TL;DR — Recommended stack for HeyMaya service product

**Hybrid: Zernio (formerly Late, getlate.dev) for posting + a thin direct-Google-Business-Profile-API layer for review reply + Pub/Sub webhooks.** Zernio gives one OAuth flow, one billing line, and one normalized API across GBP / FB / IG / TikTok / LinkedIn / X / YouTube / Pinterest / Threads / Reddit / Bluesky / WhatsApp at $19–$49/mo flat — no per-call fees, no enterprise contract, no Meta/TikTok app-review hell. The catch: Zernio is a 5-person bootstrapped company [unverified scale beyond ~hundreds of devs], so we cannot bet review-reply (the highest-value GBP feature for service businesses) on them alone — we apply for **direct Google Business Profile API access in parallel** (free, ~weeks-to-months approval) so HeyMaya owns the most differentiating capability and can fall back if Zernio pivots. Skip Hootsuite/Sprout/Birdeye/Podium — they are 10-50x more expensive and gate developer access behind enterprise sales. Skip Buffer (API in beta, no GBP). Skip Loomly (no API). Composio is not a contender for v0 — they have Instagram + LinkedIn + Meta Ads but no GBP toolkit, no Facebook Pages publishing, and no roadmap signal for either.

---

## Comparison matrix

| Option | Auth model | GBP write | GBP reviews | FB write | IG write | Webhooks | Rate limit | Pricing | Lock-in risk | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **Zernio (Late)** | One OAuth per platform, unified token storage | Yes (posts + CTA) | Reply via API [unverified for full review fetch — confirm before commit] | Yes | Yes | Yes (post.published, post.failed, analytics) | Managed by Zernio, retry+backoff included | $19/mo (Build, 120 posts) → $49/mo (Accelerate) → custom (Unlimited); +$49/mo per +50 profiles | **High** — 5-person bootstrapped, single point of failure for 12 platforms | **Primary publish layer.** |
| **Ayrshare** | Per-platform OAuth, multi-tenant via "user profiles" | Yes | Yes (reply + fetch) | Yes | Yes | Yes | Documented per platform | Free (20 posts) → **$149/mo** Premium → $499/mo Business (30 profiles) → $8.99/extra profile | Medium — established, more mature than Zernio | **Backup if Zernio dies.** Not first pick — 8x the cost. |
| **Sociality.io** | Enterprise OAuth | Yes (claims) | Likely | Yes | Yes | Likely | Not public | Enterprise quote only, no public price | Medium (enterprise lock-in, contracts) | **Skip.** No public pricing = not viable for $19.99 consumer SaaS. |
| **EmbedSocial** | Per-platform OAuth, GBP-first | Yes | Yes (reply + auto-responder by star rating) | Yes | Yes | Limited | Not public | Plans from ~$29/mo for GBP mgmt; API pricing on request | Medium | **Skip as primary.** Useful as a GBP-only fallback if direct Google access is delayed. |
| **Hootsuite API** | Per-app review, Hootsuite-account dependent | Limited | Limited | Yes | Yes | Limited | Yes | API "free" but requires $99/mo+ Hootsuite seat; enterprise $15k+/yr; right-to-charge reserved | High — pricing-change risk + review gate | **Skip.** API is theater; real cost is the seat. |
| **Buffer API** | OAuth | None — no GBP | None | Yes | Yes | Limited | 60 req/user/min | GraphQL beta as of Apr 2026, not GA | High (their last API was killed in 2019; trust low) | **Skip.** Burned developers once already. |
| **Sprout Social API** | OAuth | Limited | Limited | Yes | Yes | Yes | Standard | **$399/seat/mo Advanced tier minimum** | High enterprise lock-in | **Skip.** Pricing absurd for our segment. |
| **Loomly API** | — | — | — | — | — | — | — | No public API | N/A | **Skip.** No API exists. |
| **Direct GBP API** | Google OAuth (per-creator), `business.manage` scope | Yes (LocalPosts, recurring posts) | Yes (read + reply, media) | — | — | Yes via Cloud Pub/Sub (NEW_REVIEW, UPDATED_REVIEW, etc.) | 300 QPM default after approval; 10 edits/min/profile | Free; partner approval required (multi-week, no SLA) | Low (Google primary source) | **Required.** Own the highest-value endpoint. |
| **Meta Graph API (FB Pages + IG Business)** | Facebook Login for Business, IG Business linked to FB Page | Yes | — | Yes (Page posts) | Yes (publish, reply comments, mentions, hashtags) | Yes | **200 calls/user/hr (BUC)** — reduced 96% from 5,000 in 2025 | Free; **Advanced Access requires App Review + Business Verification + annual Data Use Checkup** | Low (Meta primary) but heavy compliance | **Eventually own.** Use Zernio first to ship; migrate if scale forces it. |
| **TikTok Content Posting API** | TikTok OAuth, `video.publish` scope | — | — | — | — | Limited | Standard | Free; **5–10 business day app review + audit required** (else posts are private-only) | Low | Use via Zernio in v0; direct only if needed. |
| **LinkedIn Marketing API** | LinkedIn Partner Program required | — | — | Page posts (Org) | — | Limited | Standard | Free; **Partner Program approval = weeks-to-months, often rejected** | Very high — gated, opaque | Use via Zernio in v0. Direct path is closed for most apps. |
| **Composio (GBP + FB)** | Composio-managed OAuth | **No GBP toolkit** | No | **No FB Pages publishing** (Metaads = ads only) | Yes (IG Business/Creator) | Via Composio | Composio plan-bound | Composio plan pricing | Adds Composio dependency on top of Meta/Google | **Don't use for v0 social/GBP.** Keep Composio for Gmail/Stripe/Calendar (already in stack). |
| **Birdeye** | Reseller account | Via partner | Yes | Yes | Yes | Yes | n/a | **$299–$1000+/mo per location**; Dominate $449/mo white-label | Very high (per-location pricing kills unit econ) | **Skip.** Unit economics break at $19.99 tier. |
| **Podium API** | Dev portal | Via partner | Yes | Yes | Yes | Yes | Custom | **$399/mo+ starting**; opaque | Very high | **Skip.** Same problem as Birdeye. |
| **NiceJob API** | Per-tenant API key | Via integration | Yes (request + collect) | Limited | Limited | Yes | Custom | Not public; gated developer agreement | Medium | **Skip as platform.** Possibly useful as an inspiration/competitor reference. |
| **Yelp Fusion (Places) API** | API key | — | Read-only (3 reviews/biz Plus, 7 Enterprise; first 160 chars only) | — | — | No | Plan-bound | Plus + Enterprise tiers (data licensing); Fusion AI new | Low | **Read-only review monitoring only.** No reply via API — Yelp gates reply to their own UI. |
| **Apple Business Connect API** | Gated to listing-mgmt partners | Via partner only | Insights only, no reviews-reply API surface | — | — | Limited | n/a | Free to businesses; API access via Yext / Rio SEO / SOCi / Reputation / Uberall | Very high (locked to 5 named partners) | **Skip in v0.** Revisit if/when Apple opens direct API. Apple Business launched April 14, 2026 — still partner-gated. |
| **Trustpilot API** | OAuth | — | Read + invite + reply | — | — | Limited | Standard | **$299/mo basic → $6k–$18k/yr Premium**; API gated to paying biz | Medium | **Skip in v0.** Service businesses rarely on Trustpilot; revisit if a creator asks. |
| **Postiz / Mixpost (open source)** | Self-OAuth per platform | Limited GBP | Limited | Yes | Yes | Yes | Self-hosted | Free (self-host) or one-time license (Mixpost) | None (we own the code) | **Optional escape hatch.** If Zernio/Ayrshare both fail, we can fork Postiz and run our own — but we eat all the platform-API maintenance cost. Not v0. |

---

## Detailed findings

### Tier 1 — Unified social management APIs

#### Zernio (formerly Late, getlate.dev)
- **What it is.** One REST API → 14+ platforms: Instagram, TikTok, X, LinkedIn, Facebook, YouTube, Threads, Reddit, Pinterest, Bluesky, WhatsApp, Telegram, Discord, Snapchat, **Google Business Profile**.
- **Auth model.** Each creator OAuths each platform individually, but Zernio stores tokens and exposes them via a single profile-id abstraction. From HeyMaya's POV: one SDK, one token store, one webhook signature scheme.
- **GBP capability.** Posts to GBP with text up to 1,500 chars + 1 image (JPG/PNG) + CTA buttons (Learn More / Book / Order / Shop / Sign Up / Call). Uses Google's official Business Profile API under the hood — no Cloud Console setup needed by the creator. Review-reply support claimed but documentation depth not confirmed [unverified — must validate before commit].
- **Webhooks.** Real-time webhooks for `post.published`, `post.failed`, analytics-ready events; signature-verified; built-in retry with exponential backoff. Claimed 98.8% delivery rate, 99.7% uptime SLA.
- **Pricing.** Free (20 posts/mo, 2 profiles) → Build $19/mo (120 posts, 10 profiles) → Accelerate $49/mo → Unlimited custom. Each +50 profiles = +$49/mo. **No per-call fees.** Annual saves 2 months.
- **Lock-in risk: HIGH.** Bootstrapped 5-person team (founder Miki Palet), profitable but no funding moat. If they pivot/shut down, every creator's posting pipeline breaks. Mitigation: keep all OAuth tokens we control where possible, and design the publish layer behind an interface so we can swap in Ayrshare or direct APIs in <2 weeks.
- **Verdict.** **Primary publish/scheduling layer.** Best price/feature ratio in the category. The lock-in risk is real but acceptable if we interface-isolate.

#### Ayrshare
- **What it is.** Same shape as Zernio — unified API across IG, FB, X, LinkedIn, YouTube, **GBP**, Pinterest, TikTok, Reddit, Telegram. More mature, longer-running.
- **Auth model.** Per-platform OAuth wrapped in Ayrshare "user profiles" for multi-tenant.
- **GBP capability.** Full publish + analytics + comments. Review handling documented better than Zernio.
- **Pricing.** Free (20 posts) → Premium **$149/mo** → Business $499/mo (30 profiles) → +$8.99/profile. **8x more expensive than Zernio at the entry tier.**
- **Lock-in risk: Medium.** Established player, less likely to die suddenly.
- **Verdict.** **Hot-swap backup behind the publish interface.** If Zernio falters, we flip a config flag.

#### Sociality.io
- **What it is.** Enterprise unified API for FB / IG / LinkedIn / TikTok / YouTube. GBP coverage not confirmed in current documentation.
- **Pricing.** Quote-only, no public tier. Enterprise sales motion.
- **Verdict.** **Skip.** Wrong segment for a $19.99 consumer product.

#### EmbedSocial
- **What it is.** GBP-first management platform with API access. Auto-responder by star rating is a notable feature for Maya's review-reply behavior.
- **Pricing.** Plans from ~$29/mo for GBP management; API pricing custom.
- **Verdict.** **Skip as primary.** Could be useful as a GBP-only stopgap if direct Google partner approval is delayed.

#### Hootsuite API
- **API itself:** "free" — but only meaningful if you have a $99/mo+ Hootsuite seat per user, enterprise pricing $15k/yr, $1.8–2k per additional seat. Hootsuite explicitly reserves the right to start charging.
- **Verdict.** **Skip.** The "free API" is a marketing line; real cost is the SaaS seat, which we'd be reselling at huge negative margin.

#### Buffer API
- Buffer **killed** their public API in 2019 (47k devs disconnected). New GraphQL API in early-access beta as of Apr 2026 — not GA. **No GBP support.** 60 req/user/min.
- **Verdict.** **Skip.** Trust is broken; product doesn't include GBP anyway.

#### Sprout Social API
- API gated to Advanced plan = **$399/seat/mo**. 3-seat team = $1,197/mo just for API access.
- **Verdict.** **Skip.** Wrong economics.

#### Loomly API
- **No public API exists.**
- **Verdict.** **Skip.**

### Tier 2 — Direct platform APIs

#### Google Business Profile API (Google official)
- **Access.** Free, but you must apply: Cloud project + Organization account + GBP API contact form. Approval gates the QPM quota: 0 = pending, 300 QPM = approved. **No published SLA on review time.** Anecdotally weeks to months. Mature partners (EmbedSocial, Birdeye etc.) all hold approved status.
- **Auth.** OAuth 2.0 with `business.manage` (the older `plus.business.manage` is deprecated but back-compat). Per-creator OAuth flow.
- **Endpoints we'd care about.**
  - `LocalPosts` — create / list / update / delete posts (incl. recurring posts, added 2025+).
  - `Reviews` — read reviews + media + reply (`reviews.updateReply`, `reviews.deleteReply`).
  - `Insights` — performance data.
  - `Locations` — read business info.
- **Webhooks.** Yes — via Cloud Pub/Sub, not HTTP webhooks directly. Subscribe a topic, then the API publishes `NEW_REVIEW`, `UPDATED_REVIEW`, `NEW_QUESTION`, `NEW_ANSWER`, location-update events. We must run a Pub/Sub subscriber.
- **Rate limits.** 300 QPM default after approval; 10 edits/min per profile for business info.
- **Verdict.** **Apply on day 1 of Sprint 0 of the service product.** Pub/Sub-driven review notifications + direct review-reply is HeyMaya's most defensible feature. We do not want this dependency to live inside a 5-person startup.

#### Meta Graph API (Facebook Pages + Instagram Business)
- **Access.** Free, but **App Review + Business Verification** is mandatory for Advanced Access (i.e. real users beyond your own Page). Annual Data Use Checkup required.
- **Auth.** Facebook Login for Business → IG Business must be linked to a FB Page. Personal accounts not supported.
- **Endpoints.** Page posts (publish, comments, insights), IG publish, comments, mentions, hashtag search, basic analytics on competitor businesses.
- **Rate limits.** **200 calls per user per hour** under Business Use Case (BUC), reduced 96% from 5,000 in 2025. App-level scales linearly with user count. DM automation capped at 200 DMs/hour.
- **Verdict.** **Plan to migrate FB+IG off Zernio onto direct Graph API in Sprint 4–5** of the service product, once we have the Meta App Review effort budgeted (typically 2–6 weeks). Zernio buys us speed-to-market; direct Graph API buys us margin and rate-limit headroom at scale.

#### TikTok Business Content Posting API
- **Access.** Free; `video.publish` scope; **app review takes 5–10 business days**, plus an unaudited-client restriction (posts are private until audit passes).
- **Verdict.** Use via Zernio in v0. Direct path only if a creator hits volume Zernio can't serve.

#### LinkedIn Marketing API
- **Access.** **Partner Program required since 2015.** No public access. Approval is "weeks to months", often rejected without explanation. Tiers: Development → Standard.
- **Verdict.** Use via Zernio in v0. The direct path is effectively closed for early-stage companies.

### Tier 3 — Niche / specific APIs

#### Composio for GBP
- Composio's 2026 toolkit covers Instagram (Business/Creator), LinkedIn, Meta Ads (paid only). **No Google Business Profile toolkit. No Facebook Pages publish toolkit.** No public roadmap signal indicating either is coming. Their 2026 strategic roadmap is around the "Self-Serve Platform" pivot, not new social toolkits.
- **Verdict.** Composio stays in our stack for Gmail / Stripe / Calendar / Apollo / Hunter as already planned (creator product). For service-product social/GBP it adds zero value.

#### Birdeye API
- $299–$1000+/mo **per location**. Reseller "Dominate" tier $449/mo per location, white-label. API is compute-unit metered, custom-priced.
- **Verdict.** Skip. Per-location pricing destroys our unit economics at the $19.99–$79.99 tier.

#### Podium API
- $399/mo starting. Opaque pricing. API on higher tiers only.
- **Verdict.** Skip — same economics problem.

#### NiceJob API
- Has API behind a developer agreement. Strong field-service ecosystem (Jobber / FieldPulse / Housecall Pro integrations). Posts review-request triggers via single API call.
- **Verdict.** Skip as a platform. Useful as a competitor reference for what review-collection workflows look like in the service-business segment.

### Tier 4 — Review monitoring

#### Yelp Fusion / Places API
- Read-only review access. Plus tier = up to 3 reviews/business; Enterprise = 7. **First 160 chars only.** No reply API — Yelp restricts reply to their own dashboard.
- New "Fusion AI API" replaces deprecated Natural Language Search.
- **Verdict.** Read-only monitoring only. Maya can surface "you got a Yelp review, go reply in the Yelp app" — she cannot reply for the operator. Acceptable for v0, document the limitation.

#### Apple Maps Connect / Apple Business Connect API
- Apple Business launched **April 14, 2026** unifying Connect + Essentials + Manager.
- API access **gated to 5 named partners**: Yext, Rio SEO, SOCi, Uberall, Reputation. Companies need 25+ locations to qualify for direct API. Reviews-reply API surface not exposed to direct developers.
- **Verdict.** Skip in v0. Re-evaluate quarterly — Apple is clearly building this out and may open direct access. If a service-business operator needs Apple Maps Showcases, recommend they use Apple Business Connect's web UI manually until then.

#### Trustpilot API
- $299/mo basic → $6k–$18k/yr Premium for full business product. APIs (Service Reviews, Product Reviews, Business Units, Private Products) gated to paying business accounts.
- **Verdict.** Skip in v0. Service businesses (HVAC, plumbing, etc.) are rarely on Trustpilot — it's e-commerce-heavy. Add if/when a real customer asks.

### Sidebar — open-source escape hatch

**Postiz** (self-hosted) and **Mixpost** (one-time license, self-hosted, 11 platforms). If both Zernio and Ayrshare fail simultaneously, we can fork Postiz, deploy on Fly, and absorb the per-platform maintenance burden. Not v0. Worth knowing exists.

---

## Open questions for operator

1. **Are you OK depending on Zernio (5-person bootstrapped, ~1-yr-old rebrand) for the publish layer in v0?** The alternative is Ayrshare at 8x the price ($149/mo entry vs $19/mo) — eats into the $19.99 Starter tier margin meaningfully. Recommendation: yes, but interface-isolate so swap is <2 weeks.
2. **Are you willing to apply for the Google Business Profile API partner approval in Sprint 0 of the service product?** Free, but unspecified wait (likely 2–8 weeks based on community reports). Without it we cannot reply to reviews directly — we'd be 100% dependent on Zernio's GBP coverage for the most differentiated feature. Recommendation: apply day 1.
3. **Are you willing to take HeyMaya through Meta App Review + Business Verification in Sprint 4–5?** Required for FB Pages + IG publishing at scale via direct Graph API. Without it, FB/IG posting goes through Zernio at Zernio's per-app rate-limit pool, which becomes a bottleneck >~500 active customers. 2–6 week effort.
4. **Yelp reply gap — are you OK telling service-business operators "Maya can monitor Yelp reviews but can't reply, you have to do that in the Yelp app"?** No API workaround exists short of scraping (TOS violation).
5. **Apple Maps Connect — are you OK punting until Apple opens direct API?** Currently gated to 5 enterprise partners; service-business operators with <25 locations cannot access it programmatically.
6. **Do we want the WhatsApp Business API?** Already implied by "iMessage / WhatsApp / SMS / web chat" channel matrix in CLAUDE.md. WhatsApp Business API is per-message priced (utility ~$0.04, marketing up to $0.24, free service replies in 24h window, free inbound up to 1,000/mo). Need to budget this separately from social — different cost model.
7. **TikTok app review (~5–10 days + audit)?** Required if we want first-class TikTok publishing for service-business creators. Defer if low priority.

---

## Sources

- [Late/Zernio pricing & platforms](https://getlate.dev/pricing)
- [Late Google Business endpoint](https://getlate.dev/google-business-api)
- [Zernio Google Business platform docs](https://docs.zernio.com/platforms/google-business)
- [Google Business Reviews API integration guide (Zernio)](https://zernio.com/blog/google-business-reviews-api)
- [Zernio company analysis (Bouchez)](https://www.alexisbouchez.com/research/zernio-social-media-api-analysis)
- [Zernio overview (Product Hunt)](https://www.producthunt.com/products/zernio)
- [Ayrshare pricing](https://www.ayrshare.com/pricing/)
- [Ayrshare vs Late comparison](https://getlate.dev/alternatives/ayrshare)
- [Sociality.io social media API](https://sociality.io/social-media-api)
- [EmbedSocial GBP API](https://embedsocial.com/gbp/api/)
- [EmbedSocial social media API](https://embedsocial.com/social-media-api/)
- [Hootsuite developer portal](https://developer.hootsuite.com)
- [Hootsuite API ToS](https://www.hootsuite.com/legal/api-terms-of-service)
- [Hootsuite API alternative analysis (Postproxy)](https://postproxy.dev/blog/hootsuite-api-alternative-lightweight-publishing-apis/)
- [Buffer "no API" status](https://zernio.com/alternatives/buffer)
- [Buffer API alternatives 2026 (Postproxy)](https://postproxy.dev/blog/what-happened-to-buffer-api-alternatives-for-developers/)
- [Sprout Social public API](https://support.sproutsocial.com/hc/en-us/articles/360045006152-Sprout-Public-API)
- [Sprout Social pricing](https://checkthat.ai/brands/sprout-social/pricing)
- [Loomly API status (apitracker)](https://apitracker.io/a/loomly)
- [Google Business Profile OAuth implementation](https://developers.google.com/my-business/content/implement-oauth)
- [Google Business Profile API FAQ](https://developers.google.com/my-business/content/faq)
- [Google Business Profile prerequisites](https://developers.google.com/my-business/content/prereqs)
- [Google Business Profile real-time notifications (Pub/Sub)](https://developers.google.com/my-business/content/notification-setup)
- [Google Business Profile NotificationSetting](https://developers.google.com/my-business/reference/notifications/rest/v1/NotificationSetting)
- [GBP partner agencies guide (Localith)](https://localith.ai/blog/google-business-profile-api-guide/)
- [Meta Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview/)
- [Meta App Review (Instagram)](https://developers.facebook.com/docs/instagram-platform/app-review/)
- [Meta Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Instagram API rate limits 200/hr explained](https://creatorflow.so/blog/instagram-api-rate-limits-explained/)
- [TikTok Content Posting API guide](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [TikTok content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)
- [LinkedIn Marketing API tiers (Microsoft Learn)](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-04)
- [LinkedIn API 2026 access guide (ConnectSafely)](https://connectsafely.ai/articles/linkedin-api-complete-guide-2026)
- [Composio Instagram toolkit](https://docs.composio.dev/toolkits/instagram)
- [Composio LinkedIn toolkit](https://docs.composio.dev/toolkits/linkedin)
- [Composio Metaads toolkit](https://composio.dev/toolkits/metaads)
- [Composio 2026 integration roadmap](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap)
- [Birdeye reseller program](https://birdeye.com/partners/resellers/)
- [Birdeye pricing 2026 (RepliFast)](https://www.replifast.com/blog/birdeye-pricing-2026)
- [Podium developer portal](https://developer.podium.com/)
- [Podium pricing breakdown (SocialPilot)](https://www.socialpilot.co/reviews/blogs/podium-pricing)
- [NiceJob developers](https://get.nicejob.com/partners/developers)
- [Yelp Fusion reviews endpoint](https://docs.developer.yelp.com/reference/v3_business_reviews)
- [Yelp Fusion data licensing](https://business.yelp.com/data/products/fusion/)
- [Yelp changelog (deprecations)](https://docs.developer.yelp.com/changelog)
- [Apple Business launch (Apple Newsroom, Mar 2026)](https://www.apple.com/newsroom/2026/03/introducing-apple-business-a-new-all-in-one-platform-for-businesses-of-all-sizes/)
- [Apple Business Connect API (Yext integration)](https://www.yext.com/integrations/publishers/apple)
- [Apple Business 2026 partner ecosystem (PinMeTo)](https://www.pinmeto.com/blog/apple-business-connect-listings-2026/)
- [Trustpilot developer portal](https://developers.trustpilot.com/)
- [Trustpilot pricing (Vendr)](https://www.vendr.com/marketplace/trustpilot)
- [WhatsApp Business platform pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [WhatsApp messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)
- [Postiz on GitHub](https://github.com/gitroomhq/postiz-app)
- [Mixpost (open source)](https://mixpost.app/)
