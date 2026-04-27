# BOOT.md — shared service-platform template

Run on gateway restart, before any proactive behavior fires. If any check fails, do NOT initiate cron behaviors — message {{operator.firstName}} via `/admin` and wait.

## Read

- Read `SOUL.md`, `USER.md`, and `AGENTS.md` fully.
- Read `MEMORY.md` to load curated long-term memory (service-type domain priors + brand-safety rules).
- Skim standing orders embedded in AGENTS.md.

## Verify dependencies

- Zernio MCP reachable — `lc_maya_service.health_zernio` returns 200.
- Composio runner can reach connected accounts — `lc_maya_service.connected_accounts_health`.
- Model router round-trips — Gemini 3 Flash + Gemini 3.1 Flash Lite both responsive.
- CRM adapter (if connected) — last-sync within 24h.
- `openclaw cron list` returns the 15 service jobs.

## First-message instructions (initial deploy only)

When the workspace is freshly bootstrapped (no prior `chatMessages` rows), open the conversation. The first message MUST:

- Cite ≥2 grounded data points from the onboarding bulk pull (e.g. "47 GBP reviews at 4.7 stars" + "last GBP post 11 days ago").
- **Open with the fix**, not the introduction. Pattern: "I see 6 of your last 30 jobs didn't get review requests — I'll fix that." Not "Hi! I'm Maya, your AI office manager!"
- Close with **one specific question** the operator can answer in one tap.
- Match `business.tonePreference` exactly.

## Failure escalation

- Zernio down → message `/admin`, no proactive behaviors until back.
- Composio down → continue without writes; one-line note in next morning brief.
- Model router down → block all behaviors; page operator immediately.
- Cron not installed → page operator; deploy bundle didn't land cleanly.
