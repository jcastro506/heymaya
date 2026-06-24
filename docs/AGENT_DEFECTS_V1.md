# Agent defect register — from the 2026-06-24 live HeyMaya demo agent

Grounded in the live prod agent (`clawlaunch-ws75zpzrh5rx48cb6q`, HeyMaya product, ~9h runtime): the Fly transcripts, the lifecycle code, and the **13 messages that actually landed** (out of **519 `send_update` calls** attempted). Ordered by severity. This is the fix backlog.

---

## P0 — Cost / runaway (burns money, blocks everything)

1. **Foundation-research re-spawn loop.** The heartbeat/lease watchdog re-runs the WHOLE ~18-worker research fleet every ~15–30 min because two "done" flags never flip: `researchComplete` (worker `subagent_complete` can't be delivered to a `not_streaming` main session → research never registers done) and `strategyDelivered` (gated on a successful strategy *send*, which the Telegram delivery never made). Result: 30 main runs, ~20× each worker, ~$20+ burned, still going at kill. *Root cause + fix in [[project-foundation-research-runaway-loop]].*
2. **Re-spawn backstop doesn't hold.** The intended 8-lease-acquire cap didn't stop it (saw 20–30×) because the main session itself keeps restarting and the cap doesn't survive restarts.
3. **Cost cap DESTROYS the machine instead of throttling.** A healthy agent's legit boot research hit its $8 cap → the sweep nearly destroyed it. Caps must degrade, not kill. *[[feedback-caps-throttle-never-destroy]]* (interim: `GTM_COST_CAP_OVERRIDE` set on prod).

## P1 — Delivery + posting (the core value is broken)

4. **Outbound delivery mostly fails.** 519 `send_update` calls → only ~13 persisted. OpenClaw's outbound to Telegram (and/or the Convex log path) is dropping the vast majority. The user gets a fraction of what she "sends."
5. **No opening hello, unreliably.** `deployTimeHelloResult: "skipped:openclaw_owns_all_operator_comms"` → OpenClaw is supposed to send the intro, but it didn't land for the operator. The whole "she texts you hello, then researches" first impression is broken.
6. **Nothing actually posts.** Message #7: *"5 replies and posts were queued for you today… None went out. X and Instagram should auto-post, but they're gated."* She does the thinking but ships zero — and the copy doesn't clearly drive the user to connect channels so she CAN post. For a "she runs your social" product, the social never runs.

## P2 — Message content / quality (reads as broken/spammy)

7. **Duplicate messages.** The morning brief went out ~twice near-identical (msg #2 ≈ #3: same "Reddit pain wall / solo dev shouting into the void"); the foundation synthesis went out **3×** (#9 "Foundation locked" ≈ #10 "Foundation locked, quick read" ≈ #12 "Foundation's done") — the loop re-sends the same beats.
8. **Too many messages / no cadence discipline.** Multiple "morning briefs" in one run (#2/#3 generic, #4 "47 threads", #8 "24 threads") + repeated foundations = spammy. A real user would mute her.
9. **Leaked internal token.** Msg #2 literally starts with **"Grade."** — an internal label (the grader/critic step) bleeding into the user-facing text.
10. **Inconsistent voice/format.** Mix of lowercase openers ("today's the shift", "founders ship fast"), "Strong signal morning", "Foundation locked", "Foundation's done" — no consistent persona or formatting across messages.
11. **Likely hallucination / grounding violation.** Msg #5: *"OpenVC's founder is publicly quitting [HubSpot] today, I've got a switch-pitch ready."* A hyper-specific real-world claim that smells fabricated — exactly the "grounded or silent" line we can't cross when she's about to post publicly as the brand.

## P3 — Lifecycle / onboarding

12. **Foundation never reaches "complete."** Stuck in research/finalize forever (see P0#1), so she keeps re-introducing herself + re-delivering the plan instead of moving to steady-state.
13. **Onboarding↔dashboard binding fragility.** The Clerk `user.created` webhook auto-spawns a stray `service-business` creator that collides on `clerkUserId` with the gtm-agent creator (had to add `bindGtmAgentToClerkUser` to clean it). A real signup could land in the wrong product.

## P4 — Architecture / complexity (the real root — the operator's point)

14. **Massively overbuilt research layer.** ~18 distinct parallel worker types (x/reddit/ig/yt/hn/tiktok/linkedin research + buyer_map + competitor_move + content_angle + channel + niche_pulse + relationship + calendar + extraction + slop_critic + channel_judge…). This fan-out is the *source* of the orchestration failures (P0#1) — too many children for the parent to reliably collect.
15. **The job is simple; the machine isn't.** At heart: (a) do great research once, then (b) engage social (post / reply / comment) on the bet channels. The current agent buries that in a fragile multi-worker, multi-gate, re-spawning orchestration. *This is the thing to simplify — see the simplification thesis discussion.*

## P5 — Product surface (tracked separately)

16. Dashboard IA + channel-tier UX + auto-post toggle + reactive-"Conversations" surface → [`docs/DASHBOARD_PRODUCT_SURFACE_V1.md`](DASHBOARD_PRODUCT_SURFACE_V1.md).

---

**The throughline:** P0/P1 (loop + delivery) make it expensive and silent; P2 (repetition/tone/hallucination) make the little that lands read as broken; P4 (overbuild) is *why* P0 happens. Fixing P4 — radically simplifying research + the engage loop — likely dissolves most of P0–P2 at the root, rather than patching each gate.
