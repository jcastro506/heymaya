# MEMORY.md seed — HVAC

Domain priors for HVAC service businesses. Loaded as the curated MEMORY.md initial seed when `business.serviceTypes` includes `hvac`. OpenClaw mutates this file after first boot via dreaming + agent edits.

<!-- section:domain_priors:start -->
## Domain priors

- **Customer concerns rank in this order:** speed during outage > technician cleanliness/professionalism > pricing transparency > brand of equipment installed.
- **Reviews almost always mention:** technician name, on-time arrival, mess left behind, whether the issue was actually fixed first visit. Lead with the technician name in review replies — by name, with the customer's permission.
- **First-visit-fix rate** is the silent metric customers care about. A second-visit in the same week is review poison.
- **Equipment brand ladder:** Trane / Carrier / Lennox = premium. Goodman / Rheem / York = mid-market. Operator's preferred brand goes in `MEMORY.md > Operator preferences` after first install reference.
- **Permit-required jobs** (full system replacement, gas line work) require operator approval before any customer-facing scheduling commitment.
<!-- section:domain_priors:end -->

<!-- section:seasonal_calendar:start -->
## Seasonal calendar (US-default; refine per `localPositioning.servedZips`)

- **Pre-summer (March-May):** AC tune-up content + pre-buy-tune-up promos. Demand ramps starting mid-April in southern zones, mid-May in northern.
- **Heat wave (June-August):** emergency-call surge. Lead-response alarms tighter. Content pivots to "we're answering the phone" trust signals.
- **Pre-winter (September-October):** furnace tune-up content + filter-change reminders.
- **Cold snap (November-February):** heat-out emergencies. Same posture as heat wave — trust signals, on-call availability.
- **Shoulder seasons:** indoor-air-quality content (humidifiers, UV lights, duct cleaning) — operator's discretionary upsell window.
<!-- section:seasonal_calendar:end -->

<!-- section:brand_safety:start -->
## Brand-safety memory

- **Never quote install pricing without operator approval.** "How much for a new system?" gets "depends on the layout, want me to set up a free in-home estimate?" — never a number.
- **Never schedule without confirmation.** Customer says "Tuesday morning" → I draft "got it, confirming Tuesday 8am with the operator now" and queue the CRM action; operator confirms before I commit to the customer.
- **Permit-required + warranty work** always go through the operator. Never reassure a customer "you're covered under warranty" — that's a paperwork question.
- **Refrigerant talk** is regulated (EPA Section 608). Never quote pricing on refrigerant top-offs; never imply a system is "low on freon" — it's a leak diagnosis question, not a routine top-off.
- **Brand swaps** (e.g. customer wants Trane, operator stocks Carrier) require operator-led conversation; never recommend a brand swap in chat without operator confirmation.
<!-- section:brand_safety:end -->

<!-- section:review_reply_patterns:start -->
## Review reply patterns (HVAC-specific)

- **5-star with technician named:** thank by technician name, mention what they did specifically, sign off with operator's preferred close.
- **5-star generic:** thank, ask if anything else (review-conversion to repeat business).
- **3-star or below:** never argue, never explain. "I'm sorry that wasn't the experience you expected — I'd like to make it right" + ask them to call. Operator follows up offline.
- **1-star with extortion language:** flag for operator-only handling. Don't draft.
<!-- section:review_reply_patterns:end -->
