# Zernio capability map and landing-page decisions

Reviewed 2026-09-08 against current official documentation and this repository. Scope: explain the integration and improve the public landing page. No provider settings, account connections, publishing permissions, billing, or backend behavior were changed.

## The product decision

Maya already combines connected post metrics with creator-specific context. The landing page previously reduced that to “honest feedback.” Make it visible: compare a post with the creator's usual performance, explain the evidence, and suggest the next experiment.

Keep the creator positioning. A vendor endpoint is not a shipped Maya feature. In particular, do not promise publishing, social inbox replies, ads, audience demographics, or additional platforms just because Zernio offers them. Provider capabilities below are documented availability, not a verification of our current subscription or account scopes.

## Provider surface versus Maya

| Capability family        | What Zernio offers                                                     | Status in this creator app                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and connections | Profiles, accounts, OAuth, health, account groups                      | One profile per creator; TikTok/Instagram connect and reconnect; health and deletion paths. Group management is not a creator feature.                               |
| Content operations       | Publishing, scheduling, queue slots, media uploads, validation         | Deliberately absent from the new integration. Maya's calendar schedules the creator's work, not an API publish.                                                      |
| Post analytics           | Counters, post comparisons, timelines, aggregate reports               | Post ingestion, historical bootstrap, delta updates, normalization, creator baselines, and interpretation are wired. The extra timeline/aggregate endpoints are not. |
| Audience intelligence    | Account insights, follower history, demographics                       | Daily follower snapshots feed weekly growth evidence. No demographics or account-insights endpoint integration.                                                      |
| Content optimization     | Best times, frequency correlations, performance decay                  | Maya has its own post-time model. These vendor endpoints are not called.                                                                                             |
| Social inbox             | Conversations, replies, comments, reviews, mentions                    | Not integrated. Maya's Telegram conversation uses our own Telegram integration.                                                                                      |
| Growth automation        | Keyword-triggered messages, contacts, broadcasts, sequences, workflows | Not integrated. No automatic social outreach is promised.                                                                                                            |
| Ads                      | Campaigns, creatives, audiences, reporting, conversions, leads         | Not integrated; would add spend controls and a separate product scope.                                                                                               |
| Messaging and telephony  | WhatsApp capabilities, numbers, SMS, voice                             | Not integrated. These do not mean Maya is available by SMS or WhatsApp.                                                                                              |
| Platform extensions      | Platform-specific management and commerce/blog operations              | Not integrated; keep the supported-platform strip to Maya's actual connections.                                                                                      |
| Developer operations     | Keys, webhooks, usage, logs, settings                                  | Signed connection/analytics webhooks and vendor health records are wired.                                                                                            |

Sources: [API resource index](https://docs.zernio.com/api-reference), [platform matrix](https://docs.zernio.com/platforms), [quickstart and capability overview](https://docs.zernio.com/).

## Platform distinctions that matter to copy

**Instagram:** connected post analytics can include reach and engagement. Reels-specific fields in the analytics API include average/total watch time, follows, and skip rate. Maya parses watch time only with a known video duration, and retains missing metrics as null. The recorded integration fixture contains a non-video post, so it verifies reach but is not proof of populated Reels retention on our current account. Describe retention as available where reported, not guaranteed for every post.

Instagram's account insights, audience demographics, and Story-specific reports are separate endpoints we have not integrated. Professional account requirements and permissions matter. Do not infer new-versus-returning viewers from reach alone.

Sources: [Instagram capabilities](https://docs.zernio.com/platforms/instagram), [post analytics fields](https://docs.zernio.com/analytics/get-analytics), [Instagram demographics](https://docs.zernio.com/analytics/get-instagram-demographics).

**TikTok:** the documented post metrics are views, likes, comments, and shares. Public APIs do not provide TikTok Studio watch time, retention, full-watch rate, or traffic-source breakdown. Zernio does not provide a TikTok comments/DM inbox. Maya can read analytics screenshots sent in Telegram; label that as creator-provided evidence, never connected retention. Compare views with views, not Instagram reach.

Source: [TikTok capabilities and limitations](https://docs.zernio.com/platforms/tiktok).

**Freshness:** historical analytics and a change feed are distinct. Responses may be pending or unavailable; an empty feed page is not evidence of zero performance. Maya already labels stale connected reads and falls back to public counters for individual-post judgments. Avoid “real-time” or “every number.”

Sources: [post analytics](https://docs.zernio.com/analytics/get-analytics), [analytics delta feed](https://docs.zernio.com/analytics/get-analytics-delta).

## Implementation evidence

| Code                                             | Evidence used for the landing page                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `convex/integrations/zernio/index.ts`            | Read-oriented adapter, two social platforms, account lifecycle, health, webhook verification. Publishing explicitly absent. |
| `convex/connections/zernio.ts`                   | `startConnect` permits active/comped accounts; trial accounts receive “connections open when the trial ends.”               |
| `convex/connections/sync.ts`                     | 90-day bootstrap, hourly delta ingestion, per-account daily follower snapshots.                                             |
| `convex/connections/analytics.ts`                | Reels duration gating, null handling, baselines, derived interpretations.                                                   |
| `convex/connections/numbers.ts`                  | Individual-post evidence labels, 48-hour freshness rule, platform-specific unknowns.                                        |
| `convex/agent/tools.ts`                          | `own_post_numbers` and `post_diagnosis` make those reads available in conversation.                                         |
| `convex/review/weekly.ts`                        | Connected metrics and follower snapshots contribute to weekly evidence.                                                     |
| `convex/agent/opinion.ts`                        | Screenshot reading; unreadable numbers are not guessed.                                                                     |
| `convex/connections/__tests__/analytics.test.ts` | Recorded Instagram/TikTok responses, retention gating, null handling, derived diagnoses.                                    |

Some old planning comments are stale: they say no accounts have ever been connected or that skip rate is never exposed. The September 5 recording/tests and current field definitions supersede those notes. No claim here relies solely on an old plan.

## Changes made to the landing page

- Add “Your numbers” navigation and an interactive “She gets your vibe. And your numbers.” section.
- Show two platforms and two outcomes, all clearly marked as example reports. No customer data or live calls.
- Give Instagram reach/watch/follows examples and TikTok views/likes/shares examples.
- Use a baseline comparison and a short Maya interpretation. Suggestions are experiments, not claims of proven causation.
- Explain screenshot support for TikTok watch time, and paid-plan access near the preview, price, and FAQ.
- Replace the old Sunday example's unsupported new-versus-regular audience claim with a reach comparison.

## Recommended next capability work

1. Make connected metrics more visible in the signed-in Results view. The backend holds richer evidence than that screen currently exposes. Preserve platform, timestamp, and null state.
2. Evaluate Instagram audience demographics and account insights using a suitably scoped real account. Only add product promises after an end-to-end user flow exists.
3. Consider a creator-approved publishing flow or Instagram comment-to-DM as separate product decisions. They require permissions, platform-policy handling, failure states, and explicit control over outbound actions. They are not part of this landing update.

Before using current vendor pricing for economics, verify our account entitlement separately: the current overview says analytics/inbox are included while some reference pages still say “add-on.” That discrepancy does not change Maya's existing paid-plan gate.
