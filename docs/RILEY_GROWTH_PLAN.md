# Riley — HeyMaya growth agent (v0 plan)

A single-user OpenClaw agent that builds pre-launch hype for HeyMaya on
LinkedIn. Operator: Josh Castro. Persona: Riley — friendly, gender-neutral,
"smart marketing intern" vibe. NOT a HeyMaya-branded product; an internal tool
that helps Josh do the founder marketing work.

**Branch:** `heymaya/growth-v0` (off `heymaya/service-v0`, so we inherit the
OpenClaw runtime image, deploy pipeline, FlyClient, GraphQL setSecrets, soak
harness, smoke fixtures).

**Deploy shape:** one Fly machine, one Riley, owned by `creators.accountType:
"growth-agent"` (additive enum value alongside `creator` / `service-business`).
Mirrors how we did `service-business`. No schema breakage — service-v0 stays
mergeable.

## What Riley does (priority order — locked v0)

1. **Drafts LinkedIn + X (Twitter) posts in Josh's voice**, using current
   Brave-search context for trend awareness. Operator approves the draft
   via text; first month Josh copy/pastes manually (hard rule — never
   auto-post in week 1; build trust + voice calibration first).
2. **Builds LinkedIn outreach lists**: searches for profiles matching
   criteria ("VPs of Marketing at home-services SaaS, 500+ connections,
   posted in last 30d"), drafts personalized DMs in Josh's voice, presents
   for approval. (LinkedIn-only — X DMs are gated + flagged; not in v0.)
3. **Watches engagement on Josh's posts** (LinkedIn + X): who liked, who
   commented, what they said. Powers daily summaries + reply suggestions.
4. **Tracks waitlist signups** (Convex table) + summarizes weekly: who's
   on the list, where they came from, which posts/DMs drove signups.

Nice-to-haves (NOT v0):
- Auto-comment on others' posts
- Auto-respond DM drafts in inbox
- Schedule/publish posts (use Buffer/Late integrations later)
- Connection requests (account-safety risk; defer)
- X DMs (gated, flagged)
- X full-archive search (Enterprise-only historically; expensive PPU)

## Architecture

```
Josh (text via iMessage)
    ↓
Riley (OpenClaw on Fly, single agent)
    ├─ Composio actions (write + light read surface)
    │   LinkedIn:
    │   - LINKEDIN_CREATE_LINKED_IN_POST   (post-publish, when we re-enable)
    │   - LINKEDIN_CREATE_COMMENT_ON_POST  (operator-approved comments)
    │   - LINKEDIN_GET_SHARE_STATS         (impressions/clicks/likes count)
    │   - LINKEDIN_GET_MY_INFO             (Josh's profile)
    │   - LINKEDIN_LIST_REACTIONS          (who liked a post)
    │   - LINKEDIN_INITIALIZE_IMAGE_UPLOAD (image flow)
    │   X / Twitter:
    │   - TWITTER_CREATE_A_POST            (tweet + reply + quote-tweet)
    │   - TWITTER_SEARCH_RECENT_TWEETS     (last 7d, trend research)
    │   - TWITTER_LOOK_UP_POST_BY_ID       (engagement metrics by tweet)
    │   - TWITTER_LIST_POST_LIKERS         (who liked Josh's tweets)
    │   - TWITTER_GET_AUTHENTICATED_USER   (Josh's profile)
    │   - TWITTER_LOOK_UP_USER_BY_USERNAME (research target accounts)
    │   - TWITTER_LIKE_A_TWEET / TWITTER_RETWEET_POST (operator-approved)
    │   - TWITTER_GET_USER'S_REVERSE_CHRONOLOGICAL_TIMELINE (home feed)
    ├─ Unipile (LinkedIn DM + search surface — Composio can't do these)
    │   - profile.search                   (build outreach lists)
    │   - chats.send_message               (DMs after operator approval)
    │   - chats.list / get                 (DM inbox state)
    │   - posts.list_comments              (read commenter text on Josh's posts)
    │   - profile.watch_posts              (target persona post-watch)
    │   - connection.send_request          (later — defer for v0)
    ├─ Brave Search (existing BRAVE_API_KEY)
    │   - market context, trend research, persona discovery
    ├─ Convex (data layer)
    │   - growthPosts            — drafted/approved/published post log
    │   - growthOutreach         — DM drafts + send state
    │   - growthWaitlist         — signups + provenance
    │   - growthCadence          — Riley-self-managed schedule notes
    └─ Memory-wiki (built-in OpenClaw plugin)
        - "what's working" learnings, voice samples, persona notes
```

## Why hybrid (Composio + Unipile)

Per `docs/spikes/composio-linkedin-research-2026-04-28.md`: Composio's
LinkedIn surface uses LinkedIn's official OAuth API (low ban risk, ~22
tools) but covers ONLY posting + comments + reactions + share stats.

LinkedIn partner-gates DMs, profile search, post-comment-text, connection
requests, profile-feed-watch. Composio doesn't have those — and we can't
get partner access self-serve.

**Unipile** is the canonical agent-friendly LinkedIn API for the gap. Uses
authenticated session/cookie under the hood, presents as a clean REST API.
~$59-99/mo for one LinkedIn account. Real flag risk if used aggressively
(>20 DMs/day, headless browser sharing session); operator-side rate
limits + approval gates keep this safe.

## Locked safety rules (v0)

1. **Every DM, comment, and post is operator-approved by text before send.**
   No autonomous posting in v0. Riley drafts, Josh approves, Riley sends
   (or Josh copy/pastes for manual posts in week 1).
2. **Cap DM volume at <20/day total**, randomize timing (LinkedIn flags
   batch-send patterns).
3. **No headless browser automation on Josh's daily LinkedIn / X session.**
   *CLI cookie-based skills (`arun-8687/linkedin-cli`, `chuhuilove/bird-twitter`)
   are a carve-out from this rule* — they replay HTTPS API calls using cookies
   rather than driving a browser, which is a meaningfully lower detection
   surface. If a cookie gets invalidated, Riley pings Josh to re-paste it
   from DevTools (30-second operator action). Browser-automation skills
   (`biostartechnology/linkedin`, `zich-dev/linkedin-automation`) remain
   excluded.
4. **Brave Search is read-only.** No publish via search-result links
   without operator review.
5. **Riley does not send connection requests in v0** — too easy to trip
   LinkedIn's "automated outreach" detector. Manual only.

## What's already there (inherited from service-v0)

- OpenClaw runtime image at `registry.fly.io/heymaya-openclaw:v2026.4.23`
- Fly deploy pipeline (`convex/onboarding/business/deployServiceMaya.ts`
  is the template — Riley gets `convex/onboarding/growth/deployRiley.ts`)
- `FlyClient` + GraphQL `setAppSecrets`
- POSIX tar workspace bundler
- Smoke fixtures + soak harness pattern
- Composio v3 client + universal runner (`convex/integrations/composio/`)
- Brave key in `.env.local` (`BRAVE_API_KEY`)
- Workspace .md generator pattern (mirror for Riley pack)

## What's new for Riley (this branch)

- `convex/agents/packs/riley_growth/` — pack folder (templates + generators)
- `convex/integrations/composio/actions/linkedin.ts` — Composio LinkedIn wrappers
- `convex/integrations/unipile/` — Unipile API client (new vendor)
- `convex/onboarding/growth/` — deploy variant + onboarding flow for Josh
- New Convex tables (additive only):
  - `growthPosts` — post log
  - `growthOutreach` — DM tracker
  - `growthWaitlist` — signup tracker
- `app/(growth)/` — minimal HQ for Josh to review drafts (single-tenant; no Clerk multi-account)

## Operator-blocked (need to do once)

**v0 path (cookie-based, locked 2026-04-29) — this is the active set:**

1. **Extract LinkedIn session cookies** from Josh's logged-in browser.
   In DevTools → Application → Cookies → `https://www.linkedin.com`,
   copy:
     - `li_at` → set as Convex env `LINKEDIN_LI_AT`
     - `JSESSIONID` → set as Convex env `LINKEDIN_JSESSIONID` (strip
       any surrounding quotes Chrome may include)
   Used by `arun-8687/linkedin-cli` for reads (search/profile/feed/messages).
2. **Extract X (Twitter) session cookies** the same way from
   `https://x.com`:
     - `auth_token` → set as Convex env `AUTH_TOKEN`
     - `ct0` → set as Convex env `CT0`
   Used by `chuhuilove/bird-twitter` for full posting + reading. **No X
   developer account or top-up needed** — cookie-auth path bypasses it.
3. **Choose voice samples** — paste 5-10 of Josh's best posts from BOTH
   LinkedIn (longer, professional) and X (punchier, conversational) into
   Riley's onboarding. Riley fits her voice per-platform; memory-wiki
   refines toward Josh's actual edits over time.
4. **(Optional) Connect LinkedIn through Composio dashboard** — only
   needed if we want Riley to publish LinkedIn posts directly instead of
   Josh copy/pasting. Per locked safety rule #1, week-1 LinkedIn posting
   is manual anyway — defer this until week 2+ if at all. Path: https://app.composio.dev
   → Apps → LinkedIn → Connect with OAuth.
5. **(Deferred) Unipile** for LinkedIn DM *sending* (Wave E). v0 reads
   come from `linkedin-cli`. Skip until DM-send is on the roadmap.
   When ready: https://www.unipile.com/ Pro tier $59-99/mo, create a
   LinkedIn session, capture `UNIPILE_API_KEY` / `UNIPILE_DSN` /
   `UNIPILE_LINKEDIN_ACCOUNT_ID`.

## Build order (waves)

1. **Wave A (this branch initial commit):** scaffolding only. Composio
   LinkedIn action stubs + Unipile client stub + Riley pack folder +
   architecture doc. NO live deployment yet. Operator can read the plan +
   confirm shape.
2. **Wave B:** Composio LinkedIn action wrappers (real, tested) +
   Unipile client (real, with one verified call). Convex schema
   additions for `growthPosts`/`growthOutreach`/`growthWaitlist`.
3. **Wave C:** Riley pack generator (SOUL/AGENTS/HEARTBEAT/etc.) +
   deploy variant + first deploy of Riley to a Fly machine. SSH-test
   the gateway boot.
4. **Wave D:** First post-draft skill + operator-approval flow via
   text. Real end-to-end: Josh texts Riley → draft via OpenRouter +
   Brave + Composio image upload → Josh approves → Riley publishes.
5. **Wave E:** Outreach list builder + DM draft skill (Unipile-driven).
6. **Wave F:** Waitlist tracking + weekly summary.

## What NOT to build in v0

- Multi-tenant growth-agent SaaS (Riley is for Josh personally;
  multi-tenant comes when HeyMaya's growth-agent product line is itself
  productized — much later).
- Auto-publishing (week-1 trust calibration first).
- Full HR / CRM integration (Josh doesn't have one; build when needed).
- A separate web app — reuse existing app folder structure with
  feature-flagged routes.
- Analytics dashboard with charts. Plain-text summaries only (basic-UI
  rule per `feedback_basic_ui_for_home_service.md` — even though Josh
  isn't an HVAC operator, the principle of "spend time on the agent's
  output, not the dashboard's pixels" applies).
