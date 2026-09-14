# Maya full-system evaluation — 2026-09-13

## Verdict

Maya's deterministic product paths are robust, and the partnership workflow is unusually well defended. Live-model quality was uneven at the start of this audit: 78 of the latest 120 scored conversational replies passed (65%). The strongest capability is specific retrieval from a large personal history. The weakest behavior was turning related evidence into unjustified certainty. This audit fixed the most consequential instance: a later post with the same theme could make Maya claim that an older, specifically missed filming commitment had happened.

After the fixes, the full suite passes 676 tests with 2 intentional image-generation skips. The corrected long-tenure memory probes pass 2/2 live, and the final eligible proactive scout message passes 1/1 live; the second scenario correctly stayed quiet because no candidate was worth sending.

## What was exercised

- onboarding state, first read, conversational questions, and dossier creation
- a synthetic year containing 70 posts, 123 ideas, hundreds of messages, preferences, corrections, goals, commitments, style snapshots, and forgotten private information
- live-model recall of old decisions, superseded preferences, filmed and missed commitments, changing style, taste versus performance, and a deliberately forgotten fact
- proactive scouting, creator fit, evidence grounding, voice matching, link integrity, quiet behavior, daily caps, and calendar-derived opportunities
- connected-account/Zernio contracts, reconciliation, analytics normalization, account caps, public-versus-owner metrics, and webhook boundaries
- Google Calendar OAuth contracts, privacy classification, 14-day sync horizon, availability, weekly planning, explicit-consent booking, reminders, moved/deleted events, and disconnect/forget behavior
- iOS Messages/iMessage pairing, unique phone ownership, signed inbound webhook, deduplication, tapbacks, attachments, menus in plain text, iMessage/RCS/SMS service parsing, fail-closed delivery, and SMS fallback contracts
- partnership discovery, fit judgment, evidence, drafts, exact approval codes, Gmail send records, reply sync, follow-up state, hostile prompt injection, and cross-tenant isolation
- billing tiers, server-side allowances, deletion, retention, job retries/dead letters, cost caps, and plain-language leak guards

## Calendar operating cadence

- Calendar data is synchronized every 30 minutes and reads one day back through 14 days ahead.
- Maya evaluates the scout queue hourly during daytime, but sends only when a candidate survives relevance, evidence, taste, quiet-hour, open-question, and daily-cap checks. The total proactive cap is three messages per day across eligible touches; silence is a valid result.
- The creator receives one weekly planning proposal on Sunday at 6:00 p.m. in their timezone. The plan uses their posting cadence, learned filming habits, selected ideas, experiments, and busy calendar windows.
- Maya writes content blocks to Google Calendar only after an explicit button tap or clear chat request. She then schedules preparation and follow-up touches and responds when a connected event moves or disappears.
- A weekly performance review runs Sunday morning in the creator's timezone. Morning and post-shoot messages are event-driven rather than a fixed daily quota.

## Findings fixed in this audit

1. Commitment recall returned the remembered promise without hydrating the linked calendar block's filmed/missed outcome. Recall now includes the recorded outcome, and a regression test covers a missed commitment.
2. Current quiet hours were absent from the writer's authoritative context. They are now included verbatim with the creator timezone, and current settings explicitly outrank old remembered rules.
3. Maya could attach invented performance support or causal language to a correctly remembered decision. Her evidence rules now prohibit adding numbers, causal claims, or supporting history that is not separately present.
4. The proactive writer used a generic “your lane” explanation and an emoji despite a measured zero-emoji style. The prompt now requires a creator-specific reason, and zero-emoji preference is enforced before delivery. The live rerun improved from specificity 1/3 and would-send 1/3 to 3/3 and 3/3, then passed after deterministic voice enforcement.
5. A stale-rubric or missing-baseline gate returned `ok: true` even though it could not compare results. It now fails closed with `ok: false` and explains how to record a valid baseline.
6. The long-tenure seed could become permanently unseedable if its creator row was created but the action stopped before the first artifact. The harness now distinguishes that empty interrupted state and resumes it.
7. Two gauntlet assertions rejected correct English or contained an accidental backspace character. Both matchers were corrected.

## Evidence and limits

- Full deterministic suite: 95 files, 676 passed, 2 skipped.
- Focused calendar and iOS messaging run: 84 tests passed before the added memory and voice tests.
- Partnership controlled-provider gauntlet: 11/11 passed (`2026-09-12-partnership-adversarial.json`). It uses controlled Tavily and Gmail providers, so it proves workflow and safety behavior rather than real-world email deliverability.
- Initial long-tenure live run: 6/9. One failure was a faulty assertion, one reflected mutated eval settings, and one exposed the real commitment-outcome defect. Corrected high-risk rerun: 2/2.
- Final proactive scout: one eligible message passed; one scenario correctly returned “nothing worth their time today.”
- The 65% conversational figure is a mixed historical window and should not be treated as the post-fix launch score. A clean, isolated scenario reset is needed before freezing a new rubric-7 baseline.
- No real message was sent to a person's phone. The Claw Messenger adapter is verified against its documented contract and the fake vendor; its own source notes that it has not yet been proven against a live line.
- No real Google account was connected during this audit. Calendar logic, OAuth boundaries, provider contracts, privacy behavior, and simulated end-to-end flows passed, but live token refresh and event creation require a dedicated test Google account.
- Zernio logic and recorded API shapes passed. A real connected-account round trip was not run against a customer account because the audit does not have a designated disposable social account.
- The development deployment lacks `GEMINI_API_KEY`, so embeddings fall back to lexical/word-overlap recall. Live replies still used the configured OpenRouter key. Production should either configure Gemini embeddings or explicitly standardize and evaluate the fallback as the intended retrieval mode.

## Remaining launch checks

1. Run one disposable iPhone number through pairing, inbound text, tapback, attachment, iMessage delivery, forced SMS fallback, and failure recovery.
2. Connect a disposable Google Calendar, verify refresh after token expiry, select/deselect calendars, approve a weekly plan, observe the created events, move one externally, and confirm Maya's follow-up.
3. Connect disposable TikTok and Instagram accounts through Zernio and compare profile, post, and owner analytics against the native apps.
4. Reset the two live eval creators to immutable fixtures, run the complete rubric-7 conversation bank, manually label a sample, and record a new baseline only if it clears the agreed launch threshold.
5. Test partnership delivery with a controlled real mailbox before allowing the pilot to contact external brands.
