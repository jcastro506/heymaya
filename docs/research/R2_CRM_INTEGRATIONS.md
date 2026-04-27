# R2 — Service business CRM/FSM API landscape (2026-04-27)

> Research-only audit of every relevant home-service CRM/FSM API a HeyMaya-style agent could plug into. Sources cited inline. Items marked `[unverified]` are claims I could not independently confirm via official docs.

---

## TL;DR — Recommended CRM integration priority for HeyMaya

For a small startup that needs API access fast, with no enterprise sales cycle, **ship Jobber + Housecall Pro + QuickBooks Online first.** Jobber is the easiest on-ramp (GraphQL, OAuth 2.0, self-serve dev center, ~250K customers, marketplace exists). Housecall Pro covers a large overlapping mid-market (~30K+ pros) but **gates API behind their MAX plan ($329/mo) on the customer's side** — this is a real friction point we eat or surface. QuickBooks Online is the de-facto fallback for the long tail of trades who run their books in QB without a vertical FSM. **Defer ServiceTitan to v1+** — its enterprise-grade partner gate (one-time approval, sandbox provisioning, mandatory annual recertification, partner agreement + order form) is a 4–8 week (minimum) cycle better aligned with a post-PMF push. JobNimbus and AccuLynx are roofing-only deep wedges — light up only if the operator's ICP is roofing.

---

## Comparison matrix

| CRM | Market segment | API? | Auth | Webhooks | Partner gate | Cost | Beta access | Verdict |
|---|---|---|---|---|---|---|---|---|
| **ServiceTitan** | Enterprise residential trades (HVAC/plumb/electric) ~8K customers | Yes (V2) | OAuth 2.0 client_credentials + tenant ID | Yes (event-driven via Webhook API) | **Hard.** Partner agreement, integration eval call, workflow Q'naire, sandbox provisioning, annual recert | Customer pays $245-$500+/tech/mo; partner fees set in agreement order form | Possible via "Request Access" but expect weeks; weekly approval batches | **Defer to v1+** — high-ticket customers but enterprise sales motion |
| **Housecall Pro** | SMB home service ~30K+ pros | Yes (v1 public) | API key OR OAuth 2.0 | Yes (job/customer/estimate events) | Self-serve developer dashboard | Free for dev; **customer must be on MAX plan ($329/mo)** for API to be enabled | Yes — sign up, get keys | **Ship in v0** if ICP includes mid-market |
| **Jobber** | SMB home service ~250K users, 50+ industries | Yes (GraphQL) | OAuth 2.0, scoped | Yes (HMAC-signed, at-least-once, 1s ack required) | Self-serve dev center; app review only required for marketplace listing | Free for dev; customer's own plan tier may gate certain features ([unverified]) | Yes — open dev center, sandbox available | **Ship first** — easiest API in the category |
| **FieldEdge** | Mid-market HVAC/plumb/electric | Yes (Azure-managed) | [unverified] (likely API key) | [unverified] | Partner network exists but opaque process | Custom; contact sales | Unclear — must apply | **Defer** — opacity is a red flag |
| **Workiz** | SMB locksmith/garage/cleaning | Yes (REST v1) | API key (developer add-on); also user/pass + MFA, optional SSO/OAuth | Yes (configurable via UI) | Self-serve once add-on enabled | Customer must enable "developer API" add-on; cost not publicly listed | Yes | **Tier 2** — niche but accessible |
| **Service Fusion** | SMB multi-trade | Yes (REST/JSON) | API key/token | [unverified] | Self-serve once on Pro plan | API gated to Pro plan customers | Yes | **Tier 2** |
| **mHelpDesk** | Mid-market multi-trade (Sage-owned) | Yes (REST) | API key / token | Yes [partial confirm] | [unverified — contact sales likely] | [unverified] | Probably opaque | **Defer** — declining product, Sage uncertain roadmap |
| **Smart Service** | QuickBooks Desktop add-on | No public API; custom dev only | N/A | N/A | "Custom development services" via vendor | Quote-based | No self-serve | **Skip** — talk to QuickBooks directly |
| **Kickserv** | SMB multi-trade | Yes (REST/XML, v2) | HTTP Basic with employee API token | [unverified] | Self-serve | Free for any paid customer | Yes — Swagger UI live | **Tier 2** — small footprint but easy |
| **Aspire** | Enterprise landscaping (ServiceTitan-owned) | Yes — **Enterprise tier only** | [unverified] | [unverified] | Hard — Enterprise customer required | Customer pays Enterprise pricing | No | **Skip** for v0 |
| **AccuLynx** | Roofing | Yes (REST) | API key per company location | Yes (job updates, financials, invoices, status) | Self-serve once "AppConnections" add-on enabled | Customer pays for AppConnections add-on | Yes | **Tier 2** — only if ICP is roofing |
| **JobNimbus** | Roofing/contracting ~6K orgs | Yes (Open API) | API key + OAuth 2.0 | Yes [partial confirm] | Self-serve | Free with paid customer plan | Yes | **Tier 2** — roofing wedge |
| **Markate** | SMB cleaning/handyman | Yes (Connect API) | [unverified — likely API key] | [unverified] | **Approval required** via api@markate.com | **$50/mo for "Connect API & Developer Access"** add-on | Slow — email gated | **Tier 3** |
| **RazorSync** | SMB HVAC/electric/plumb | Yes (REST) | Token + ServerName headers | [unverified] | Self-serve | Customer-side cost only | Yes | **Tier 2** |
| **QuickBooks Online** | Universal accounting | Yes (mature REST) | OAuth 2.0 (`com.intuit.quickbooks.accounting` scope) | Yes (entity-level for Customer/Invoice/etc.) | Self-serve via Intuit Developer | Free dev; customer pays QBO sub | Yes | **Ship in v0** as universal fallback |
| **Google Calendar** | Universal scheduling | Yes (mature REST) | OAuth 2.0 | Yes (push notifications) | Self-serve | Free | Yes | Already in Composio scope |
| **Stripe** | Payments | Yes (mature REST) | API key / Connect OAuth | Yes (rich events) | Self-serve | Per-txn | Yes | Already integrated |
| **Twilio** | SMS / WhatsApp / voice | Yes | API key + auth token | Yes | Self-serve | $0.0083/SMS, $0.005/WA, $1.15/mo local DID | Yes (free trial credit) | Already in v0 channel routing |

---

## Detailed findings

### Tier 1 — Major home-service CRMs

#### ServiceTitan

- **Market position.** Enterprise gorilla of residential trades. ~8,000 active customers, $772M ARR (2024), avg $78K ACV. Heavily concentrated in plumbing (276), heating (227), HVAC (200) per enlyft. Has 12.67% share of the FSM-software category overall.
- **API.** V2 is GA; V1 is sunset. Two portals: `developer.servicetitan.io` (request access + FAQs) and `partnerapis.servicetitan.io` (catalog + reference).
- **Auth.** OAuth 2.0 client-credentials grant + a per-tenant ID. App key + client ID/secret pattern.
- **Endpoints.** Broad — jobs, customers, locations, technicians, dispatch, invoices, payments, payroll, inventory, marketing, reporting, memberships, equipment. Comprehensive enough to build full external workflows.
- **Webhooks.** Supported.
- **Partner gate (the painful part).**
  - Three tiers: **Silver** (entry, sandbox + marketplace), **Gold** (deeper product/marketing access), **Titanium** (top performers).
  - Process: Integration Evaluation Call → Workflow Recommendation → Data + API Workflow Questionnaire → sandbox provisioning → app build → certification.
  - **Approvals are batched weekly** with "a few business days" turnaround once submitted, but the *full* certification cycle (eval call, questionnaire, sandbox, build, review) is realistically multi-week.
  - **Mandatory annual recertification** of every published app.
  - "Partner-specific fees, models, payment schedules" are set by agreement + executed order form. Concrete dollars not public.
- **Customer-side cost.** $245–$500+/tech/mo + 30–50% upcharge for Pro modules + $5K–$50K implementation. ServiceTitan customers are big businesses by definition.
- **Beta access path.** `developer.servicetitan.io/request-access/` — submit request, expect weeks not days.
- **Verdict.** Real revenue lives here, but the gating is hostile to "indie startup ships first integration in a week." Defer to v1+.

#### Housecall Pro

- **Market position.** ~30,000+ "pros" in their community. Strong SMB wedge, "Pro" personas of 1–50 employees per Software Advice review demographics.
- **API.** Public v1. Docs at `docs.housecallpro.com`.
- **Auth.** API keys (Admin generates) **or** OAuth 2.0 with client ID/secret + redirect URI configured in dev dashboard. Both are documented and supported.
- **Endpoints (confirmed).** Jobs (get/create/list), customers (CRUD), estimates, employees, line items, invoices/payments. Job inbox / leads endpoint (newer).
- **Webhooks.** Yes. Confirmed events include `customer.created`, `customer.updated`, `customer.deleted`, `estimate.*`, `job.created`, `job.updated`, `job.scheduled`, `job.finished`. Per Help Center, "wide range of events" — full enumerated list lives in docs page that I couldn't pull through WebFetch (denied), but the categories are: customer, job, estimate, invoice, payment.
- **Partner gate.** None upstream. Self-serve dev dashboard.
- **Cost.** *Free for the developer*. **Crucial gotcha: Housecall Pro's MAX plan ($329/mo, up to 8 users) is the only tier where API + webhooks are enabled for the customer.** A creator/operator on Basic ($59/mo) or Essentials ($149/mo) cannot enable the integration. This is the actual blocker, not the dev portal.
- **Rate limits.** Not publicly documented. Third-party guides assume ~150 rpm/account [unverified].
- **Beta access.** Self-serve, fast.
- **Verdict.** Ship it in v0. Surface the MAX-plan requirement clearly in onboarding. Many of the most-engaged Housecall users are already on MAX.

#### Jobber

- **Market position.** ~250,000 home-service businesses (was 200K in Feb 2023, grew to 250K+ since). $13B billed via platform / 27M households (per TC '23). 50+ verticals — HVAC, landscaping, plumbing, cleaning, construction. 3.53% market share in workforce mgmt category.
- **API.** **GraphQL** (the only category leader using GraphQL). Docs + interactive GraphiQL at `developer.getjobber.com`.
- **Auth.** OAuth 2.0 with client ID + secret per app. Installations issue access tokens scoped to specific Jobber accounts.
- **Endpoints (via GraphQL schema).** Clients, jobs, quotes, requests, invoices, payments, expenses, line items, properties, scheduling, time sheets, users. Full CRUD via mutations.
- **Webhooks.** Yes. Topics enumerated in `WebHookTopicEnum` GraphQL enum (e.g., `CLIENT_CREATE`, `CLIENT_UPDATE`, `JOB_CREATE`, etc., scoped by the app's read scopes). HMAC-SHA256 signature in `X-Jobber-Hmac-SHA256` header. **Must ack within 1 second.** At-least-once delivery → idempotency required.
- **Rate limits.** **Two limiters**:
  1. DDoS via Rack::Attack: 2,500 requests / 5 min per app/account → `429`.
  2. **GraphQL query-cost budget**: every app+account has a points budget; complex queries cost more.
- **Scopes.** Granular — clients, jobs, quotes, invoices each have read/write scopes shown on the OAuth consent screen. Webhook topic access requires the matching read scope.
- **Partner gate.** None to start building. App marketplace publication requires:
  - App build → Jobber App Review approval (testing process has 3 main steps) → ~2-week beta with selected Jobber customers → public launch.
  - Apps must handle disconnects properly to be approved.
- **Cost.** Dev access free. Plus plan ($599/mo) includes a "API tour" Zoom with Jobber's API specialists + sandbox setup. **No per-call API fees.**
- **Beta access.** Open dev center, signup free, sandbox available.
- **Verdict.** **Ship Jobber first.** Cleanest API in the category, biggest SMB customer base, friendliest dev experience.

#### FieldEdge

- **Market position.** HVAC-heavy mid-market. Acquired by Advent and now part of a portfolio that includes other trades software.
- **API.** Yes — hosted on Azure API Management at `docs.api.fieldedge.com`.
- **Auth/endpoints/webhooks.** Documentation site exists but I could not confirm specifics (WebFetch denied). [unverified — likely API key based on Azure APIM patterns].
- **Partner gate.** Partner network page exists at `fieldedge.com/partners/` but the application/approval flow is opaque — no self-serve developer signup observable.
- **Cost.** Customer-side pricing not public; quote-based.
- **Verdict.** **Defer.** The opacity (no public auth flow, no rate limits doc, no clear partner SLA) is a startup-hostile signal.

#### Workiz

- **Market position.** Newer entrant. Strong in locksmith, garage door, appliance repair, junk removal.
- **API.** REST v1 at `https://api.workiz.com/api/v1/`. Docs at `developer.workiz.com`.
- **Auth.** Customer enables the "developer API" add-on from the Workiz Feature Center/Marketplace, which exposes API credentials. Username/password + MFA primary; optional SSO/OAuth when enabled.
- **Endpoints.** Standard REST surface for jobs, clients, schedules.
- **Webhooks.** Yes — configurable in UI (`help.workiz.com/hc/en-us/articles/39192462158993`). Supports async event delivery for things like payment settlement and job status changes.
- **Cost.** Add-on cost not publicly listed (customer side).
- **Verdict.** Tier 2 — solid niche product, accessible API, light docs.

#### Service Fusion

- **Market position.** SMB multi-trade. Acquired by EverCommerce (2021) — operating independently still.
- **API.** REST/JSON at `docs.servicefusion.com`. CRUD on customers, jobs, estimates, technicians, inventory.
- **Auth.** API keys / tokens.
- **Webhooks.** [unverified] — not surfaced clearly in the integrate.io / Service Fusion docs we could see.
- **Cost gate.** **API access is Pro-plan only** (customer side).
- **Verdict.** Tier 2 — easy enough but webhook story unclear.

#### mHelpDesk

- **Market position.** Sage-owned (acquired with the Field Service group). Mid-market, declining momentum based on recent reviews.
- **API.** REST exists. CRUD on customers, jobs, estimates, invoices, payments, users.
- **Auth.** API key / token-based with scoped permissions.
- **Webhooks.** Yes [partial — third-party sources confirm "near-real-time" event push for job completion / invoice payment].
- **Partner gate.** [unverified] — likely contact-sales since dev portal not publicly indexed.
- **Verdict.** **Skip for v0.** Sage's roadmap on this product is unclear; building deep here is risky.

#### Smart Service

- **Market position.** Premier QuickBooks Desktop add-on for field service.
- **API.** **No public API.** Vendor offers "custom development services" — i.e., paid bespoke integration work.
- **Verdict.** **Skip.** Talk to QuickBooks directly for these customers.

#### Kickserv

- **Market position.** Small footprint SMB.
- **API.** Public REST/XML, v2. Live Swagger UI at `app.kickserv.com/api-docs`.
- **Auth.** HTTP Basic Auth using an employee's API token (found in employee mgmt section).
- **Endpoints.** Customers, jobs, estimates, invoices, employees.
- **Verdict.** Tier 2 — easy to integrate, low customer count.

### Tier 2 — Vertical-specific CRMs

#### Aspire (landscaping, ServiceTitan-owned since 2022)

- **API.** Yes — but **only at Enterprise tier**. Open API capabilities are explicitly sold as an Enterprise differentiator. Lower tiers cannot integrate.
- **Verdict.** **Skip for v0.** Aspire's customers are big landscape orgs — not the indie-operator ICP HeyMaya is most likely targeting.

#### AccuLynx (roofing)

- **API.** REST at `apidocs.acculynx.com`. Customer must enable the "AppConnections" add-on.
- **Auth.** API key per company location (granular control).
- **Endpoints.** Leads, jobs, documents, payments, invoices, job financials, milestones, insurance company assignment.
- **Webhooks.** Yes — job updates, financial changes, invoice updates, status changes.
- **Verdict.** Tier 2 — ship if ICP is roofing.

#### JobNimbus (roofing/contracting)

- **Market position.** ~6,000 contractors, mostly roofing.
- **API.** Open API. Postman docs at `documenter.getpostman.com/view/3919598/S11PpG4x`.
- **Auth.** API key (from Settings > API tab) **and** OAuth 2.0 (`https://app.jobnimbus.com/oauth/token`). API keys can be assigned an "access profile" to scope permissions.
- **Endpoints.** Jobs, contacts, tasks, files, estimates, invoices, payments.
- **Verdict.** Tier 2 — solid roofing wedge.

#### Markate (cleaning/handyman)

- **API.** REST "Connect API" (form-encoded request, JSON response). Postman docs at `documenter.getpostman.com/view/1022061/Tz5qYwJi`.
- **Partner gate.** **Approval required** — must email `api@markate.com`.
- **Cost.** **$50/mo "Connect API & Developer Access" add-on** (customer-paid). Markate explicitly disclaims integration support obligations.
- **Verdict.** Tier 3 — small, gated, paid. Not worth v0 effort.

#### RazorSync (HVAC/electrical/plumbing)

- **API.** REST at `https://<servername>.0.razorsync.com/ApiService.svc/`.
- **Auth.** Per-request headers: `Token`, `ServerName`, plus standard `Content-Type`/`Content-Length`/`Host`.
- **Endpoints.** Customer, Work Order/Schedule, Invoice, Quote, Settings.
- **Verdict.** Tier 2 — accessible but smaller footprint.

### Tier 3 — Adjacent integrations

#### QuickBooks Online (Intuit)

- **Why it matters.** A massive number of SMB service operators run QuickBooks Online as their book of record without a vertical FSM. If they don't have a CRM, they have QBO. This is the universal fallback.
- **API.** Mature REST. Docs at `developer.intuit.com/app/developer/qbo/docs/develop`.
- **Auth.** OAuth 2.0. Two scopes: `com.intuit.quickbooks.accounting` (full access to all entities) and `com.intuit.quickbooks.payment` (payments only).
- **Endpoints.** Customers, Invoices, Payments, Estimates, Items, Vendors, Bills, JournalEntries, Reports, etc. **"Job"-style work tracking is via `Customer` parent/sub relationship + `Estimate`/`Invoice`** — there is no first-class Job entity in QBO, but the pattern works.
- **Webhooks.** Yes — entity-level notifications for Customer, Invoice, and other entities.
- **Cost.** Dev access free. Customer pays QBO subscription.
- **Verdict.** **Ship in v0.** Universal fallback when no FSM is connected.

#### Google Calendar API

- Already mapped in Composio. OAuth 2.0, push notifications via `watch` channels. Free.

#### Stripe

- Already integrated for HeyMaya billing. OAuth Connect available if we ever need to read a creator's payments for the v0.5 service-business pivot. Rich webhook event surface. Free dev.

#### Twilio

- Already in v0 channel routing (SMS fallback when iMessage/WhatsApp not available).
- Pricing: $0.0083/SMS segment + carrier fees; $0.005/WhatsApp message + Meta template fees; $1.15/mo per US local DID, $2.15/mo toll-free.
- Free trial credit; Developer support tier $250/mo.
- Webhooks for inbound SMS, delivery status, etc.

---

## What "minimum viable CRM integration" looks like

For each priority CRM the absolute floor we need to ship a useful HeyMaya skill:

**Read (must-have):**
- Customers — list + search by phone or email
- Jobs — list upcoming + list by status (open / scheduled / completed)
- Schedule — read this week's appointments
- Invoices — list + status (paid / unpaid / overdue)

**Write (should-have for proactive value):**
- Customers — create + update (phone, email, notes)
- Jobs — create new job, update status
- Notes/messages on a job — append a note ("AI: customer prefers morning slots")

**Event (the real product unlock):**
- Webhook on `job.created`, `job.completed`, `invoice.paid`, `invoice.overdue` → triggers Maya's proactive ping ("Your 2pm at the Smiths just wrapped — want me to draft the follow-up text?")

**Optional / per-vertical:**
- Photos uploaded to job (roofing, cleaning before/after)
- Estimate PDF (contract-redflag-style scan)
- Reviews / ratings sync (after-job follow-up loop)

**The four CRMs that hit all three tiers cleanly out of the gate:** Jobber, Housecall Pro, JobNimbus, AccuLynx. ServiceTitan does too, but with weeks of partner overhead.

---

## Operator decision points

1. **Pick the v0 ICP first.** This is the single most load-bearing decision:
   - "SMB multi-trade generalist" → ship Jobber + Housecall Pro + QBO.
   - "Roofing wedge" → ship JobNimbus + AccuLynx + QBO.
   - "Mid-market HVAC" → grit your teeth, start the ServiceTitan partner application now, and wedge with FieldEdge in parallel.
2. **Partner program applications to start NOW** (long lead times):
   - **ServiceTitan** — even if we don't ship in v0, file the access request today. Weeks of approval + sandbox + recert cycle. `developer.servicetitan.io/request-access/`.
   - **Markate** — email `api@markate.com` if cleaning is in scope. Slow.
   - **FieldEdge** — start a partner conversation at `fieldedge.com/partners/` even just to get a contact.
3. **Surface the MAX-plan gating in onboarding for Housecall Pro.** Don't let a creator connect, fail silently, and churn. Detect plan tier post-OAuth and route them to an upgrade prompt or a fallback workflow.
4. **Risk: deep-building into a CRM that pivots/sells.** Aspire was acquired by ServiceTitan in 2022. mHelpDesk is in slow Sage purgatory. Service Fusion is under EverCommerce. **Always isolate CRM-specific code behind an adapter interface** so we can swap or add backends without touching Maya's behavioral skills.
5. **Composio coverage check.** Composio v3 already lists many of these (Housecall Pro, Jobber, ServiceTitan via partner programs) — confirm before re-implementing. If Composio gives us the OAuth flow + auth rotation for free, that's weeks of saved work per CRM.
6. **Pricing implication.** None of these CRMs charge developer per-call fees today. The hidden cost is the customer-side plan tier (Housecall MAX, Service Fusion Pro, Workiz add-on, Markate $50/mo, Aspire Enterprise). HeyMaya's pricing tiers (Starter $19.99 / Pro $39.99 / Studio $79.99) need to acknowledge that some integrations require the customer be on a higher CRM tier.

---

## Sources

### ServiceTitan
- [ServiceTitan Developer Portal](https://developer.servicetitan.io/)
- [Partner APIs — Welcome](https://partnerapis.servicetitan.io/docs/welcome/)
- [Partner APIs — Overview](https://partnerapis.servicetitan.io/docs/overview/)
- [Create and Manage Applications](https://partnerapis.servicetitan.io/docs/create-and-manage-applications/)
- [App Marketplace Program Guide](https://www.servicetitan.com/legal/app-marketplace-program-guide)
- [Become a Certified Provider](https://www.servicetitan.com/become-a-certified-provider)
- [Partner Program Agreement](https://www.servicetitan.com/legal/partner-program-agreement)
- [API Terms of Use](https://www.servicetitan.com/legal/api-terms)
- [Request API Access](https://developer.servicetitan.io/request-access/)
- [FAQs: Developers](https://developer.servicetitan.io/docs/faqs-developers/)
- [ServiceTitan revenue & valuation — Sacra](https://sacra.com/c/servicetitan/)
- [enlyft — ServiceTitan market share](https://enlyft.com/tech/products/servicetitan)
- [ServiceTitan pricing real costs — fieldcamp.ai](https://fieldcamp.ai/reviews/servicetitan/)

### Housecall Pro
- [Housecall Pro API docs](https://docs.housecallpro.com/)
- [Authentication](https://docs.housecallpro.com/docs/housecall-public-api/b87d37ae48a0d-authentication)
- [Webhooks](https://docs.housecallpro.com/docs/housecall-public-api/46e9e1be07621-webhooks)
- [API Overview — Help Center](https://help.housecallpro.com/en/articles/8505035-api-overview)
- [How to Enable Webhooks](https://help.housecallpro.com/en/articles/5683520-how-to-enable-webhooks)
- [Pricing](https://www.housecallpro.com/pricing/)
- [Pricing breakdown — Tooled Up Pro](https://tooleduppro.com/guides/housecall-pro-pricing/)

### Jobber
- [Developer docs](https://developer.getjobber.com/docs/)
- [Getting Started](https://developer.getjobber.com/docs/getting_started/)
- [App Authorization (OAuth 2.0)](https://developer.getjobber.com/docs/building_your_app/app_authorization/)
- [API Queries and Mutations](https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/)
- [Setting up Webhooks](https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/)
- [API Rate Limits](https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits/)
- [Application Lifecycle](https://developer.getjobber.com/docs/building_your_app/app_lifecycle/)
- [Developer Center — Help Center](https://help.getjobber.com/hc/en-us/articles/25924078048151-Developer-Center)
- [Plus Plan](https://help.getjobber.com/hc/en-us/articles/29668508840727-The-Plus-Plan)
- [Jobber Pricing](https://www.getjobber.com/pricing/)
- [Jobber 200K users — TechCrunch '23](https://techcrunch.com/2023/02/07/jobber-fixes-on-100m-as-its-platform-for-home-services-pros-hits-200k-users/)
- [Building an App in Jobber Platform — DEV](https://dev.to/jobber/building-an-app-in-jobber-platform-5259)

### FieldEdge
- [FieldEdge API Docs (Azure APIM)](https://docs.api.fieldedge.com/)
- [FieldEdge Partners](https://fieldedge.com/partners/)
- [FieldEdge Integrations One-Pager](https://fieldedge.com/wp-content/uploads/2022/01/FE_Integrations_One-pager_v3_2022.pdf)
- [FieldEdge — GetApp](https://www.getapp.com/operations-management-software/a/fieldedge/)

### Workiz
- [Workiz Developer](https://developer.workiz.com/)
- [Workiz API credentials](https://help.workiz.com/hc/en-us/articles/18053137531409-Accessing-your-Workiz-API-credentials)
- [Creating webhooks in Workiz](https://help.workiz.com/hc/en-us/articles/39192462158993-Creating-webhooks-in-Workiz)
- [Workiz on apitracker.io](https://apitracker.io/a/workiz)

### Service Fusion
- [Service Fusion API docs](https://docs.servicefusion.com/)
- [Open API Getting Started](https://servicefusion.zendesk.com/hc/en-us/articles/360035145811-Open-API-Integration-Getting-Started)
- [Open API Use Cases](https://servicefusion.zendesk.com/hc/en-us/articles/360035146591-Open-API-Integration-Use-Cases)
- [A Deep Dive into the Service Fusion API — integrate.io](https://www.integrate.io/blog/deep-dive-into-the-service-fusion-api/)
- [Service Fusion Pricing](https://www.servicefusion.com/pricing)

### mHelpDesk / Smart Service / Kickserv
- [mHelpDesk Capterra](https://www.capterra.com/p/77264/mHelpDesk/)
- [Smart Service Integrations](https://www.smartservice.com/integrations)
- [Kickserv Developer API](https://help.kickserv.com/article/4-developer-api)
- [Kickserv Swagger UI](https://app.kickserv.com/api-docs)
- [Kickserv on apitracker.io](https://apitracker.io/a/kickserv)

### Aspire / AccuLynx / JobNimbus / Markate / RazorSync
- [Aspire Plans](https://www.youraspire.com/aspire-plans)
- [AccuLynx AppConnections](https://acculynx.com/appconnections/)
- [AccuLynx API docs](https://apidocs.acculynx.com/docs/getting-started)
- [JobNimbus Open API](https://support.jobnimbus.com/how-do-i-create-an-integration-using-jobnimbuss-open-api)
- [JobNimbus Postman](https://documenter.getpostman.com/view/3919598/S11PpG4x)
- [Markate Connect API terms](https://www.markate.com/terms-connect-api)
- [Markate Connect Postman](https://documenter.getpostman.com/view/1022061/Tz5qYwJi)
- [Markate Pricing](https://www.markate.com/pricing)
- [RazorSync API docs](https://help.razorsync.com/api-documentation)

### Adjacent
- [Intuit Developer — QuickBooks Online](https://developer.intuit.com/app/developer/qbo/docs/develop)
- [QBO OAuth 2.0 FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq)
- [What you can do with the QBO API](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)
- [Twilio Pricing](https://www.twilio.com/en-us/pricing)
- [Twilio WhatsApp Pricing](https://www.twilio.com/en-us/whatsapp/pricing)
- [Twilio Messaging Pricing](https://www.twilio.com/en-us/pricing/messaging)
