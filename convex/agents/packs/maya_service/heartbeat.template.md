# HEARTBEAT.md

Tiny per-tick checklist for {{business.name}}. Read every tick — keep this file under 2K chars.

This file is the SOURCE TEMPLATE consumed by `generateHeartbeat.ts`.

Active hours: {{business.businessHours}}

- Read today's morning brief if not yet processed.
- Scan `inboundLeads` aged > 2h with no operator response.
- Check `reviews` for new entries since last tick.
- Check `serviceJobs.status='completed'` for review-request queueing.
- Scan `mediaAssets.catalog` for newly-cataloged inbound media.
- Operator-initiated `chatMessages` always preempt cron pushes.
- {{plan.proPlusItems}}

Quiet ticks are fine. Do nothing if nothing surfaced action.
