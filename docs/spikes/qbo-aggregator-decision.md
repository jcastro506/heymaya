# Spike — Apideck vs Unified.to for QuickBooks Online (locked)

> Sprint 4 / Sprint 5 dependency per `docs/SPRINT_PLAN_SERVICE_V0.md` § 13. Decided here so Sprint 5 build is unblocked. Author: Wave C QBO agent, 2026-04-27.

**Decision: Unified.to** — single Pro plan ($300/mo flat, unlimited connections) covers our QBO + 100-connection v0 footprint cleanly, normalized accounting model preserves QBO Customer parent/sub via `parent_id`, webhook signature scheme is straightforward HMAC-SHA256, and the developer-experience-first positioning matches our small-team velocity better than Apideck's enterprise-sales motion.

## Comparison

| Axis | Apideck Accounting Unified API | Unified.to Accounting |
|---|---|---|
| **Auth model** | Apideck Vault hosts OAuth flows; tokens encrypted server-side; refresh handled. Per-connection `consumer_id`. | Hosted-auth flow returns a single `connection_id`; tokens managed + auto-refreshed server-side. Same shape across providers. |
| **QBO entity coverage** | Customer, Invoice, Item, Payment, Bill, JournalEntry, etc. Sub-customer hierarchy: `parent` field on `Customer` resource. **Estimate is missing from accounting unified domain — must use Apideck's CRM domain `Opportunity` or fall through to passthrough endpoint.** | Customer (`parent_id` for sub-customer), Invoice, Item, Payment, **Estimate** as first-class resource in accounting domain (`/accounting/{conn}/quote` maps to QBO Estimate per provider mapping). |
| **Webhooks** | Entity-level via Apideck's webhook subscriptions service (`customer.created`, `invoice.updated`, etc.). HMAC-SHA256 with `x-apideck-signature` header. Idempotency via `event_id`. | Entity-level via Unified webhook subscriptions (`accounting.customer.created`, `accounting.invoice.updated`, etc.). HMAC-SHA256 with `x-unified-signature` header (raw body digest, hex). Idempotency via `event_id`. |
| **Pricing (covers QBO + 100 conns)** | Pricing tiered by service-area + connection count; QBO under "Accounting" service. **Public starter ~$299/mo + per-connection overage past 25**. 100 connections lands in custom-quote territory. Operator long-lead: sales call. | **Single flat Pro plan $300/mo, unlimited connections, unlimited API calls.** No sales call. Self-serve signup. |
| **Data normalization fidelity** | Mature, "thick" normalized schema; opinionated. Known gap: QBO Estimate is not in the accounting unified resource set as a first-class type (only Quote in some service families). Sub-customer `parent` link preserved. | Lighter-touch normalization with `raw` payload always available. `Customer.parent_id` preserved. Estimate present as Quote-aliased resource. Faithfulness to QBO concepts is high because the SDK retains a `raw` field on every entity. |
| **Sandbox** | Apideck offers sandbox connectors; QBO sandbox connection requires Intuit sandbox app credentials. Self-serve. | Unified offers a "test" workspace with sandbox QBO connector. Self-serve. Both ride on Intuit's QBO Sandbox (free for developers). |
| **DX / velocity fit** | Mature, enterprise-leaning. SDK across many languages. Slightly heavier integration ceremony (Vault hosted-page flow). | Newer, smaller, Postman-style explorer. Good defaults. Lighter SDK surface; fits Convex Edge HTTP-only better. |

## Why Unified.to wins for our v0

1. **Estimate as a first-class accounting entity** — the operator workflow we care most about (estimate → invoice progression for the no-CRM Persona A path) needs Estimate normalized cleanly. Apideck punts on this in the unified Accounting domain; Unified.to keeps it in-domain.
2. **Pricing predictability** — flat $300/mo flat fits the operator's long-lead checklist without a sales-call gate. We are not enterprise.
3. **`raw` payload escape hatch** — every Unified.to entity exposes the underlying QBO payload alongside the normalized shape. Sub-customer hierarchy, custom fields, `SyncToken` for QBO concurrency control — all reachable when we need them.
4. **HMAC scheme is identical** to Zernio's, so our existing webhook idempotency + signature-verify pattern (`convex/integrations/zernio/webhooks.ts` + `convex/lib/webhookSecret.ts`) ports cleanly with one `x-unified-signature` header swap.

If Unified.to's QBO estimate mapping turns out to be incomplete during live-smoke (operator-blocked until QBO sandbox creds + Unified workspace exist), the wrapper interface is isolated — swap the implementation behind `convex/integrations/aggregators/unified/` to `apideck/` is a one-line change in `convex/integrations/crm/quickbooks.ts`.

## Operator long-leads (do now in parallel)

- Create Unified.to account at https://unified.to/ → Pro plan ($300/mo) → grab workspace API key → set `UNIFIED_API_KEY` in Convex env.
- Create Intuit Developer account → create QBO Sandbox app → grab client id + secret → upload to Unified.to QBO connector config.
- Add `UNIFIED_WEBHOOK_SECRET` to Convex env after creating webhook subscription in Unified dashboard pointed at `${PUBLIC_URL}/api/webhooks/qbo`.
