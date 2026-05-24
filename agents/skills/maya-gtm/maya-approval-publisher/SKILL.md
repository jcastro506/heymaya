---
name: maya-approval-publisher
description: Handle approval → publish flow. Composio for LinkedIn/Reddit; manual handoff for TikTok / IG / X-without-API.
---

# maya-approval-publisher

## Purpose

The ONE place where Maya turns approved drafts into live posts. Enforces the approval gate, picks the right write-path (Composio for some platforms, manual handoff for others), refuses to publish when PLAYBOOK rules say not to.

## When to invoke

- IF a calendar event is at scheduled time AND `approvalState === "APPROVED"` THEN publish.
- IF operator explicitly says "post this now" AND draft is approved + slop-clean THEN publish.
- NEVER from heartbeat.
- NEVER for TikTok / IG Stories / X-without-API write — manual handoffs (tiktok.md § 12).

## Required reads

1. APP.md, GTM.md.
2. **PLAYBOOK.md § 6 (anti-slop last check), § 8 (when NOT to launch), § 9 (rules 9.5/9.6/9.7/9.9/9.22).**
3. playbook/{channel}.md.
4. MEMORY.md.

## Decision rules

1. **Pre-publish slop re-check.** Invoke `maya-slop-critic` ONE more time on final draft. Drafts can drift between approval and publish. Anything other than `approved` = refuse, move event to `NEEDS REVISION`.
2. **Phase-gate refusal.** IF `channelStrategy.primaryPhase === "phase_1"` AND draft is mode=OFFER THEN refuse (rule 9.5). Cold-start is BUILD + ENGAGE only.
3. **Audience-minimum refusal.** IF channel doesn't meet Phase 1 minimums THEN refuse with `refusalReason: "rule_9.3"`.
4. **Hard-launch precondition (rules 9.6/9.7/9.22).** Verify: 5-piece kit complete, first-50 DM list seeded, ≥1 unprompted testimonial. Any missing → refuse with `pushBy7Days: true`.
5. **Day-of-week refusal.** Mon/Fri/weekend + not explicit override → flag + require re-confirmation.
6. **Channel-write-path routing.**
   - **LinkedIn** → Composio publish (text + document + first-comment URL).
   - **Reddit** → Composio post + auto-post pre-drafted first comment within 60 sec.
   - **X** → write only if operator on Basic/PAYG/Pro tier AND opt-in; else manual handoff.
   - **TikTok** → ALWAYS manual handoff.
   - **Instagram Stories / Reels** → manual handoff.
   - **Gmail / Calendar** → Composio (operational, not social).
7. **URL-in-first-comment for strict subs.** r/Entrepreneur / r/startups / r/SaaS → URL in first comment.
8. **Cross-post block.** Identical text to >1 channel in <7 days → refuse. Each channel needs a rewrite.
9. **Operator-override documented.** In MEMORY.md with predicted failure mode.
10. **Post-publish state machine.** On success: write back to calendar event (approvalState = PUBLISHED), record `publishedAt` + live URL, register results-reviewer follow-up at T+2h, T+24h, T+7d.

## Output schema

```ts
interface PublishResult {
  status: "published" | "manual_handoff_sent" | "refused" | "deferred";
  liveUrl?: string;
  channel: string;
  refusalReason?: string;
  manualHandoffPacket?: {
    deliveredTo: "imessage" | "whatsapp" | "sms" | "email";
    pasteableDraft: string;
    attachmentLinks: string[];
    postingInstructions: string[];
  };
  postPublishFollowups: Array<{ triggerAtUtc: string; skill: "maya-results-reviewer" }>;
  rulesCited: string[];
}
```

## Failure modes

- **Composio token expired / OAuth disconnected.** `refused` + reconnect URL. Don't silently retry.
- **Platform-API write failure (e.g. LinkedIn 401, Reddit AutoMod removal).** Capture error code/body verbatim. Mark event `NEEDS REVISION`. No auto-retry without operator approval.
- **Slop-drift between approval and publish.** Refuse, return to slop-critic.
- **PLAYBOOK § 8 hard-refuse case detected late.** Refuse with rule 9.14.

## Cost discipline

Composio: 1-2 calls per publish. 0 ScrapeCreators. 1 main_maya (low thinking — orchestration). 1 slop-critic invocation. Timeout 5 min.

## Anti-slop check

INVOKES `maya-slop-critic` as final gate. `postingInstructions` strings in manual-handoff packets pass slop-critic too: write "post at 9am Tue, first comment URL", not "Excited to schedule your launch! 🚀".
