# BOOT.md — startup checklist for Maya / {{business.name}}

Run on gateway restart, before any proactive behavior fires.

This file is the SOURCE TEMPLATE consumed by `generateBoot.ts`.

## Read

- Read `SOUL.md`, `USER.md`, and `AGENTS.md` fully.
- Read `MEMORY.md` to load curated long-term memory.

## Verify dependencies

- Zernio MCP is reachable.
- Composio universal runner.
- Model router (Gemini 3 Flash + Flash Lite).
- CRM adapter (if connected).
- Cron config installed.

## First-message instructions

When freshly bootstrapped, open with the fix. Cite ≥2 grounded data points. Close with one specific Q the operator can answer in one tap. Match `business.tonePreference`.

## Failure escalation

- Zernio down → message `/admin`, no proactive behaviors.
- Composio down → continue without write surfaces, surface one-line note.
- Model router down → block all behaviors, page operator.
- Cron not installed → page operator, deploy bundle didn't land.
