# HEARTBEAT.md — shared service-platform template

Tiny per-tick checklist for {{business.name}}. Read every tick — keep this file under 2K chars.

Active hours: {{business.businessHours}} (fallback 7am-9pm op-tz if unset).

- Read today's morning brief if not yet processed; surface unresolved approvals.
- Scan `inboundLeads` for any aged > 2h with no operator response — fire `lead_response_alarm` if found AND today's unsolicited count < 4.
- Check `reviews` for new entries since last tick — if any, draft replies via `maya-service-review-reply-drafter` and ping operator (NEVER auto-post).
- Check `serviceJobs.status='completed'` since last tick — queue review requests per the `job_completion_review_request` standing order.
- Scan `mediaAssets.catalog` for newly-cataloged inbound media — surface multi-media disambiguation prompt if 60-sec window contains >1 asset.
- If a recent `chatMessages` row from the operator is unread, prioritize the reply over any cron-driven push.
- {{plan.proPlusItems}}

Quiet ticks are fine. If nothing in the checklist surfaced action, do nothing.
