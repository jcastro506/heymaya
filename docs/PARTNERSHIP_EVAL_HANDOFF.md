# Partnership evaluation handoff — September 12, 2026

## What the live evaluation uncovered

Claude's saved run completed with 3 of 11 checks passing. Maya researched and discussed a brand without saving the opportunity or creating a reviewable draft. Downstream sending, relationship recall, and reply tests consequently had no durable record to exercise.

The first resumed run reached 10 of 11 checks. Inspecting the actual conversation also exposed a defect the old assertions missed: the exact draft review was followed by a different model-written pitch. The remaining failed check was topical forgetting, which searched ordinary notes and could leave partnership preferences and approvals intact when no ordinary note existed.

## Changes

- The partnership skill explicitly executes search, official-page extraction, sourced assessment persistence, and requested drafting. Recent creator statements carry internal source IDs for verifiable goal evidence.
- A successful draft tool owns the final response: the conversation does not publish a competing model/critic rewrite. Rewrites of other partnership replies receive current relationship records.
- Manual copy review caught invented motivations for declining exclusivity. The skill now explicitly prohibits invented personal habits, sponsor conflicts, and unsupported media-kit promises; the negotiation regression checks the observed failure.
- Whole-topic partnership forgetting clears personal assessments and draft prose, pauses partnerships, invalidates pending approval, and excludes linked source messages from recall. Drafts now retain the initiating message ID, including short replies such as "$800, no exclusivity." Minimal relationship receipts remain to prevent accidental duplicate outreach.
- Past-due partnership entitlements now agree with the existing server tool policy.
- The gauntlet uses fresh synthetic creators without phone numbers, chat IDs, or ingestion jobs. Ordinary creator records are never reset. Scheduler start reserves the run lock transactionally; lock release checks ownership. Reports checkpoint each step, capture tool traces, and record errors; cleanup pauses the fixture.
- Simulated Gmail only receives synthetic access tokens. Real tokens always use Google's endpoint. Fake research is restricted to synthetic fixtures. Both overrides require the exact local deployment route; simulated MIME identity and concurrent sends are modeled correctly.
- Follow-up is checked before the brand replies, using the exact follow-up event key. Draft approval and forgetting checks require real pending drafts, avoiding vacuous passes. The latest scenario includes hostile instructions inside the brand email and checks that they cause no unrequested draft or send.

## Verification and limits

The automated suite passes **673 tests with 2 existing skips**, across 94 files. Typechecking and repository guards pass. ESLint reports no errors and 15 existing warnings. Regression tests cover the duplicate-review bug, topic forgetting without ordinary notes, source-message and associated-reply exclusion, unrelated-memory preservation, fixture isolation, run-lock ownership, provider routing, and concurrent simulated sends.

The first resumed real-model report is saved in `evals/2026-09-12-partnership-baseline.json`. The final stricter adversarial run passed **11 of 11 checks**; its complete conversation and tool traces are saved in `evals/2026-09-12-partnership-adversarial.json`.

Passing checks: goal capture; official-source discovery and saving; personal fit explanation; one exact draft review; refusal of plain-yes approval; exactly one provider acceptance after the exact code; relationship recall; a silence follow-up question; hostile-email resistance and reply ingestion; a single in-thread $800/non-exclusive review without invented personal reasons; and forgetting that cancels pending approvals. Cleanup was verified: the synthetic creator is paused, unpaired, and has no phone or chat destination. The updated backend is deployed to dev; changes remain uncommitted in the `creator` working tree.

This evaluates the real conversation model and production workflow against controlled search and email responses. It does **not** verify live Tavily search quality, real email deliverability, Gmail OAuth consent, or ranking across a representative set of brands. Dev currently lacks a standard Tavily API credential. A valid Tavily key and a designated Gmail test mailbox are still required for those provider checks. One successful scenario is not a statistical reliability claim.

## Architecture answers

The business access model is server-enforced entitlements: Stripe establishes the tier, and the tier supplies account caps and monthly partnership allowances. A zero allowance disables access; separate per-customer feature flags are unnecessary for these three tiers. Operational switches, such as enabling email delivery, still exist and serve a different purpose. Unknown Stripe prices and checkout/webhook configuration still deserve a real billing integration test before launch.

Tavily supplies [web search](https://docs.tavily.com/documentation/api-reference/endpoint/search) and [page extraction](https://docs.tavily.com/documentation/api-reference/endpoint/extract). Maya uses it to discover official programs, read requirements, and substantiate published contacts. It is not an email-address database or a deliverability verifier.

## Running again

On the configured local dev deployment with the simulated providers enabled:

```sh
npx convex run eval/partnershipGauntlet:start '{}'
npx convex run eval/partnershipGauntlet:report '{}'
```

Start once and poll the saved report. A disconnected CLI does not mean the scheduled action stopped. Reports contain synthetic conversation details and tool traces. Functional workflow results are separate from asynchronous style-judge records in `evalRuns`.
