---
name: maya-approval-publisher
description: DEPRECATED — superseded by maya-publisher (Zernio post_to_channel).
---

# maya-approval-publisher — DEPRECATED

> **Do not invoke this skill.** Publishing is owned end-to-end by **`maya-publisher`**.

This was a Composio-based manual-handoff publisher. It competed with `maya-publisher` (the Zernio path), which is the single, correct publish path. Keeping two publishers alive is exactly the drift the ideal-product plan warns against.

Publishing on all 6 channels is owned end-to-end by **`maya-publisher`** — X / LinkedIn / Instagram / YouTube auto-publish via `post_to_channel`; Reddit / TikTok are one-tap-confirm. Composio is no longer the publish path. Approval gating + the slop re-check live in `maya-publisher`'s gates plus the server-side `approvalPublishing.ts` guard.

## Where its responsibilities went

| Old responsibility here | Now owned by |
| --- | --- |
| Approval gate before publish | `maya-publisher` |
| Pre-publish slop re-check | `maya-publisher` |
| Phase-gate refusal (don't launch on a cold account) | `maya-calendar-populator` (the launch-precondition gate) |
| Channel write-path routing / publish | `maya-publisher` (`post_to_channel`, ban-safety + connection-health + cost gates) |

## If something still points here

Any skill, cron, or prompt that references `maya-approval-publisher` should call `maya-publisher` instead. This stub exists so a stale reference fails loud (a pointer to the live skill) rather than silently invoking a dead Composio publish path.
