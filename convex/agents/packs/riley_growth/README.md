# Riley — growth-agent pack

Single-user OpenClaw agent that builds pre-launch hype for HeyMaya on
LinkedIn. Operator: Josh Castro. Persona: Riley.

**Branch:** `heymaya/growth-v0` (off `heymaya/service-v0`).

**Locked plan:** see `docs/RILEY_GROWTH_PLAN.md`. This README is the
in-tree reminder of where to look + what's here.

## Pack structure (planned, mirrors `maya_service/`)

| File | Purpose | Status |
|---|---|---|
| `agents.template.md` | AGENTS.md template — operating instructions | Wave C |
| `soul.template.md` | SOUL.md template — Riley's personality + Josh's voice | Wave C |
| `boot.template.md` | BOOT.md — first-turn checklist for Riley | Wave C |
| `heartbeat.template.md` | HEARTBEAT.md — what Riley does each beat | Wave C |
| `tools.template.md` | TOOLS.md — the LinkedIn + Unipile + Brave + Convex tool surface | Wave C |
| `dreaming.template.md` | DREAMING.md — nightly reflection: which posts performed, who engaged, what to do next | Wave C |
| `generateAgents.ts` | Render the AGENTS.md per Josh's voice samples | Wave C |
| `generateSoul.ts` | Render SOUL.md (Riley + Josh's voice) | Wave C |
| `generateBoot.ts` | Render BOOT.md | Wave C |
| `generateHeartbeat.ts` | Render HEARTBEAT.md | Wave C |
| `generateTools.ts` | Render TOOLS.md from the available skill manifest | Wave C |
| `generateDreaming.ts` | Render DREAMING.md | Wave C |
| `generateMemorySeed.ts` | Render MEMORY.md (initial voice samples + waitlist baseline) | Wave C |
| `voiceSamples.ts` | Josh's existing LinkedIn posts (operator pastes 5-10 in) | Wave C |
| `standingOrders.ts` | Riley's standing orders (the schedule SHE registers via `cron.add`, not us) | Wave C |
| `types.ts` | Pack-level types | Wave C |

## What's NOT in this pack folder

- Composio LinkedIn action wrappers — `convex/integrations/composio/actions/linkedin.ts`
- Composio X (Twitter) action wrappers — `convex/integrations/composio/actions/twitter.ts`
- Unipile client (LinkedIn DMs / search) — `convex/integrations/unipile/client.ts`
- Brave Search tool — uses existing `BRAVE_API_KEY` env, lives at the
  workspace skill layer (`agents/skills/riley-brave-search/` when added)
- Convex tables for waitlist / posts / outreach — additive in
  `convex/schema.ts` when Wave B lands

## Voice calibration

Riley's hardest job is sounding like Josh. The plan:

1. Operator pastes 5-10 of his existing LinkedIn posts into
   `voiceSamples.ts` at deploy.
2. Riley's SOUL.md generator embeds those verbatim — they're the voice
   ground-truth.
3. First post-draft skill ALSO has the samples in context. Riley drafts.
   Josh approves/edits via text. Riley learns from edits.
4. After ~5 approved drafts, the dreaming-state nightly sweep promotes
   "what's working" patterns to memory-wiki (`concepts/voice-rules/...`).

Key rule: **Riley never invents Josh's opinions on something he hasn't
talked about**. If Riley can't ground a claim in either Josh's prior
posts OR a Brave-search citation, she asks Josh first.

## Standing orders (initial draft — Wave C will refine)

These are the crons Riley will register HERSELF via `cron.add` on first
turn. Not generated as `jobs.json` (that was the wrong architecture).

| Time | Action | Skill | Tier |
|---|---|---|---|
| Mon-Fri 8:30am ET | Brave-research today's HVAC/SaaS founder discourse + draft 1 LinkedIn post + 2-3 X tweets | `riley-post-drafter` | always |
| Mon/Wed/Fri 10am ET | Find 5 net-new LinkedIn outreach targets matching ICP + draft DMs (operator approves before send) | `riley-outreach` | always |
| Daily 12pm ET | X home-feed scan: identify 3-5 conversations Josh should jump in on; draft replies | `riley-x-engagement` | always |
| Daily 7pm ET | Pull engagement on today's published posts: LinkedIn via `LINKEDIN_GET_SHARE_STATS` + Unipile commenter text; X via `TWITTER_LOOK_UP_POST_BY_ID` + `TWITTER_LIST_POST_LIKERS` | `riley-engagement-watch` | always |
| Sun 9am ET | Weekly summary: what was published per platform, what engaged, what came in via DM, waitlist signups + provenance | `riley-weekly-recap` | always |
| Daily 3am ET | Dreaming state — promote learnings to memory-wiki, adjust crons if needed | (built-in) | always |

Riley refines this list herself based on Josh's preferences. If Josh
says "stop sending me drafts before noon, do them later", Riley calls
`cron.update`.

## What this branch DOES NOT do

- Auto-publish posts (week-1 trust calibration; manual copy/paste only)
- Auto-send DMs without operator text-approval
- Auto-comment on others' posts
- Send connection requests
- Multi-tenant — Riley is for Josh personally
- Replace HeyMaya — these are sibling products that share infrastructure
