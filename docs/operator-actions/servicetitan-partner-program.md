# ServiceTitan partner program — kickoff

**Status:** operator-actionable. **Owner:** Joshua Castro. **Wave:** D (relationship kickoff). **Sprint code lands:** Sprint 7+.

## Why ServiceTitan

ServiceTitan is the dominant FSM in HVAC mid-market (10-100 trucks, $5-50M
revenue) — exactly the operators we'd serve at Studio tier on the path to
multi-location. The economics:

- Their ACV: $50k+/yr per operator.
- Their operator count: 100k+ in HVAC/plumbing/electrical alone.
- Our hypothesis: 5-10% of their operators want a marketing layer that's
  not "another dashboard." A good integration here is ARR per Studio
  operator at $200/mo × thousands of trucks.

Aggregator coverage:

- **Nango — does NOT cover ServiceTitan.** Confirmed by their docs.
- **Apideck — does NOT cover ServiceTitan.**
- **Unified.to — does NOT cover ServiceTitan.**

This is **direct-integration territory**. ServiceTitan operates a partner-
gated API — you don't get a public API key, you get a partner application
with sandbox provisioning and a contract.

## Why kick off NOW (in Wave D, ahead of Sprint 7)

Lead time. Their partner review takes 2-4 weeks. Sandbox provisioning
takes another 1-2 weeks. If we wait for Sprint 7 to start, we're 6 weeks
behind on integration work that's already gated on their side.

The deliverable in Wave D is **the application + relationship kickoff**,
not the integration code. No ServiceTitan code lands in v0.

## Application path

1. **ServiceTitan Marketplace + Partner Portal.**
   - URL: https://developer.servicetitan.io/ (public docs).
   - Partner portal: https://platform.servicetitan.io/marketplace
   - Submit a partner application (free, requires company info + integration concept).

2. **Integration concept document.**
   We'd submit a 1-pager describing:
   - The operator value: HeyMaya is the "AI marketing manager" overlay on top of their FSM.
   - The data we read: jobs (status + completion + customer phone/email), customers (LTV proxy via lifetime job value), invoices (revenue snapshot).
   - The data we write: zero — Maya never writes back to ServiceTitan in v0. We're a read-and-suggest layer.
   - The auth flow: OAuth 2.0 standard, ServiceTitan's tenant-scoped flow.
   - The webhook surface: job-completed, invoice-paid (the two events Maya cares about).

3. **Sandbox.** After approval, ServiceTitan provisions a sandbox tenant
   with sample data. We build against that. Production access requires the
   first paying operator.

4. **Marketplace listing (post-MVP).** Once we have 5+ ServiceTitan
   customers paying us, list in the Marketplace for organic discovery.

## Technical prerequisites (notes for Sprint 7+ implementation)

**Auth:**

- ServiceTitan OAuth 2.0 — tenant-scoped, per-operator.
- Token refresh handled by us (Nango doesn't proxy this provider).
- Rotate every 24h per their token policy.
- Store: `crmConnections.encryptedAccessToken` + `encryptedRefreshToken` (existing schema fields).

**Webhooks:**

- ServiceTitan publishes via custom webhook URLs we register.
- Per-tenant `webhookSecret` we generate and they sign with HMAC-SHA256.
- Subscribe to: `JobCompleted`, `InvoicePaid`, `JobBookingCreated` (for lead-attribution).
- Existing `webhookEvents` table dedupe pattern works as-is.

**SDK:**

- ServiceTitan ships a Node SDK (npm: `@servicetitan/sdk`); we'd evaluate vs custom REST client. Their SDK has historically lagged the API by 1-2 minor versions, so a thin REST wrapper may be cleaner.
- Schema-only types: we'd hand-write our `ServiceTitanJob` / `ServiceTitanCustomer` types matching their REST shape.

**Rate limiting:**

- ServiceTitan: 1500 req/min per tenant. Generous; we won't hit it on read-only.
- Webhooks: 60 deliveries/sec per tenant inbound. Handle with the existing
  `mayaTaskQueue` async dispatch pattern (1-second ack budget held).

**Testing surface:**

- Sandbox tenant for fixture-corpus generation.
- Cross-tenant isolation test must include ServiceTitan rows once integrated.
- Per-tenant webhook idempotency test (existing pattern).

## What we're NOT doing in v0

- No ServiceTitan code in this MVP. Sprint 7+ deliverable.
- No "marketplace listing" effort yet — premature.
- No Marketplace billing integration (operators pay us direct via Stripe; ServiceTitan Marketplace billing is a Phase 2 conversation).
- No write-back-to-ServiceTitan flows (Maya stays read-and-suggest until a clear operator demand emerges).

## Contact path

- Primary: ServiceTitan partner team via the developer portal application form.
- Backup: warm intro via any existing HVAC operator-customer who's on
  ServiceTitan (we'd have at least one in our beta cohort target — slot 8
  in `beta-cohort-recruitment.md`).

## Risk register

- **Application denied.** Mitigation: re-apply with operator references after
  beta cohort hits 5+ HVAC customers. ServiceTitan favors partners with proven
  operator demand.
- **Sandbox lag.** Their sandbox sometimes lags 1-2 weeks; build against
  recorded fixture data in the meantime (mirror the Mike Hansen fixture
  pattern with a sandbox-shaped JSON dump).
- **Token refresh edge cases.** ServiceTitan's refresh windows are tighter
  than Jobber's; we'd want a separate `tokenRefreshFailedAt` field on
  `crmConnections` (additive schema change in Sprint 7).
