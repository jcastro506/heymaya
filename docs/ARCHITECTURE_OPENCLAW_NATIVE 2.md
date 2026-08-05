# HeyMaya on OpenClaw — the native-first architecture (LOCKED 2026-07-15)

**Decision:** OpenClaw owns the agent. Convex owns the business. Every mechanism
that exists because we didn't trust the runtime either moves onto a native
primitive or is deleted. Every mechanism that is genuinely product (billing,
Mission Control, ban-safety, attribution, cross-tenant learning) stays in
Convex and is proud of it.

Sources: two deep sweeps on 2026-07-15 — (a) the full docs tree shipped inside
the installed OpenClaw 2026.5.26 on a live machine, (b) a complete inventory of
our custom surface with the incident scars behind each piece. This doc is the
synthesis; treat it as the spec for the rewrite PRs.

---

## 1. The ownership split

### OpenClaw owns (native, config-driven)

| Concern | Native primitive | Notes |
|---|---|---|
| Conversation memory | One persistent `agent:main:main` session (`session.dmScope: "main"`) | Daily 4am reset + pre-compaction **memory flush** (on by default) distills durable notes into memory files — the human-manager rhythm: fresh day, remembered facts. |
| Long-term memory | `MEMORY.md` + `memory/YYYY-MM-DD.md` + `memory_search` (hybrid vector+BM25, temporal decay) | Enable `memorySearch.experimental.sessionMemory: true` → past conversation turns become searchable. **The planned `get_my_recent_messages` custom tool is dead — `sessions_history` + this flag cover it.** |
| Schedule | Native cron store (`/data/cron/jobs.json`) — which we already use | Morning brief 7am / midday pulse 1pm / evening recap 8pm / weekly review Sun / monthly reset. Upgrade: weekly review moves to a `--session session:weekly_review` custom-session cron so it natively remembers prior weeks. Announce delivery + `failureDestination` replace hand-rolled failure plumbing. |
| Pulse check | Heartbeat: `every: 60m`, `activeHours 07:00–23:00`, `lightContext`, **`heartbeat.model` = cheap tier** | Task-class model slots are native (`heartbeat.model`, `compaction.model`, `subagents.model`, per-cron `--model`). Hourly ticks on a cheap model ≈ cents/day. |
| Concurrent messages | Queue **steer mode** (native default): a message arriving mid-run is injected into the active run | Kills the racing-sessions class (4× hello, plan claims) at the root — there is one run to race. |
| Session hygiene | `session.maintenance` (prune synthetic rows, disk budgets) + `contextPruning` + auto-compaction | Replaces nothing we built, prevents the 138K pathological sessions we saw. |
| Work execution | `sessions_spawn` subagents (push-based completion → wake → handoff → queue → backoff), skills, native tools | Align with the native completion chain; never re-orchestrate on top of it. The old runaway loop lived exactly here. |
| Cadence delivery | Cron `announce` (dedupes when the agent already messaged), `MEDIA:` duplicate suppression, `chat.send` idempotency keys | Audit which halves of LIFECYCLE_MESSAGING_V1 dedup are now native — most are. |

### Convex owns (product, proudly)

1. **The multi-tenant Telegram switchboard** — ONE shared @HeyMaya bot; Telegram
   allows one webhook per bot; routing by chat id is unavoidable and correct.
   This is the only reason Convex sits in the message path, per the operator.
2. **Durable business rows** — research, buyer map, scorecards, drafts,
   calendar, published posts, attribution, experiments, steering, warmth. This
   is the product's database, not agent state.
3. **Mission Control** — the web receipt. Needs the transcript (`mayaMessages`)
   and the activity/thinking feeds. Transcript persistence stays in Convex.
4. **Billing / plan gating / COGS** — cost ledger, spend throttle
   (degrade-never-destroy), tier gates. Server-side, fail-closed, ours.
5. **Ban-safety + leak firewall** — outbound screening (skill slugs, internal
   terms, AI self-reference), one-tap confirm-to-post cards (Reddit/TikTok
   consent), auto-publish gates. This is the wedge; it never moves.
6. **Cross-tenant archetype brain** — k-anonymous rollups. Inherently central.

---

## 2. The message path (rewrite target)

**Inbound:** Telegram → Convex switchboard (unchanged) → **HTTP/WS into the
persistent main session** — `chat.send {sessionKey: "agent:main:main", message,
idempotencyKey, deliver: false}` over the gateway (port 18789), or the
OpenAI-compatible HTTP API with `x-openclaw-session-key` if simpler from a
Convex action. NOT `/hooks/agent` — verified in source: hooks are hardcoded
isolated+forceNew and wrap the user's words in untrusted-content boundaries;
pointing a hook at main would RESET main.

**Outbound (replies):** the turn's final text comes back to Convex → leak
firewall → shared-bot `sendMessage` → `mayaMessages` transcript write, channel
known server-side. The agent no longer needs `send_update`/`log_message` for
replies at all. `send_update` remains for **proactive** sends (crons,
heartbeat pings) only.

**Deleted by this design:** turnId minting + threading, the envelope contract
prose, `log_message` on inbound, reply-vs-proactive classification,
`claimFounderSynthesisSend` + hello-burst + handover cooldowns (steer mode +
one session removes the race they patched), status-narration counters, the
read-back tool plan, most of the plan-delivery sprawl (Phase 0 already unified
the delivered signal; one ensure-plan-delivered sweep remains).

**Prerequisite:** enable the persistent `/data` Fly volume
(`MAYA_GTM_PERSIST_VOLUME`) — without it sessions and memory die on redeploy.

---

## 2b. The voice rule: ONE mouth, many hands

**Main is the only agent that ever speaks — to the founder or to a public
channel.** Subagents are hands, not mouths: they fetch data, save rows
(`save_foundation_*`, `save_target_thread`, …), and return their findings to
main's session. Enforced structurally, never by prompt:

- OpenClaw native: subagents get minimal prompts, no `message` tool, no
  session tools (runtime default).
- Ours: all worker entries deny `send_update`, `send_confirm_card`,
  `send_media_to_user`, `post_to_channel`, `reply_to_comment`,
  `publish_draft`, `phase_1_announce` (`WORKER_TOOL_DENY`,
  deployMayaGtm.ts). Scar: 2026-07-15, a minimal-prompt worker with the
  plugin bundle texted the founder a stale "research complete 🚀🎉" —
  subagents never read SOUL.md/AGENTS.md, so voice/discipline prose cannot
  bind them; only tool policy can.

Corollary for all future tools: when adding a plugin tool, decide whether it
is a HAND tool (data/persist — workers may hold it) or a MOUTH tool
(founder-facing/publishing — main-only, add to `WORKER_TOOL_DENY`).

## 3. What stays custom ON PURPOSE (the scars)

Per the incident record, these wrappers survive because the failure they
prevent was model-driven, not runtime-driven:

- **`deny: ["cron"]` on main** — the cadence ships deterministically in
  jobs.json; the model registered two duplicate cron sets when it had the tool
  (2026-07-15). Native cron is used; the *model driving it* is not.
- **Foundation lease + acquire cap** — the 283-session re-spawn loop. Keep
  through onboarding until steer-mode + persistent sessions prove the race is
  gone; then revisit.
- **Exactly-once plan delivery via `strategyDeliveredAt`** (Phase 0, shipped
  `14769c5`) — one sweep, one signal.
- **Spend throttle (degrade-never-destroy) + OpenRouter usage polling** — the
  runtime doesn't reliably self-report per-turn cost; the $32/$22 burns are the
  scar. Revisit if/when native usage tracking exports per-session cost.
- **Liveness watch (alert-never-kill)** — silence is a human signal.

## 4. Native features to adopt opportunistically (not blocking)

- **Commitments** (inferred follow-ups, `maxPerDay` cap) + **standing orders**
  (AGENTS.md programs + cron; the docs' canonical example is literally a
  social-media weekly cycle) + **HEARTBEAT.md `tasks:` blocks** (due-only
  checks) — together they are most of the planned "proactive outbox" (old
  Phase 2) natively.
- **Typed plugin hook for outbound-message cancellation** — the firewall could
  eventually move to the delivery layer as an OpenClaw plugin (our own code
  comment already wished for this).
- **`/tools/invoke` HTTP API** (always on, policy-enforced, hard deny list) as
  the Convex→machine control plane for web actions (draft approvals, steering)
  instead of bespoke `runAgentTurn` nudges.
- **Failure destinations on crons** → replace `deliveryFailures` plumbing.

## 5. Build order

1. **PR 1 — persistent-session inbound.** Volume on; gateway config: dmScope
   main, steer mode, session maintenance, `sessionMemory: true`, cheap
   `heartbeat.model`. Convex: switchboard forwards via `chat.send`
   (spike WS-from-action vs OpenAI-compat HTTP first); replies delivered by
   Convex (firewall + transcript). Delete the envelope path.
2. **PR 2 — dedup demolition.** Remove claims/cooldowns/reply classification;
   `messageClass` becomes analytics-only; collapse the two plan sweeps into
   one ensure-plan-delivered sweep.
3. **PR 3 — lifecycle slimming.** Resume ladder → single one-shot; align
   subagent completion handling with the native chain; web actions via
   `/tools/invoke` or `chat.send` into main (she remembers web approvals too).
4. **PR 4 — proactive layer.** Standing orders + commitments + heartbeat
   tasks replace the bespoke proactive plumbing.

Each PR live-verified on a fresh staging deploy before the next.

## 6. Version note

Machines install latest OpenClaw (2026.5.26 observed) while CLAUDE.md pins
2026.4.23 — reconcile the pin. Some documented features (Task Flow,
commitments, memory-wiki) may postdate older deploys; check availability
before depending on them.
