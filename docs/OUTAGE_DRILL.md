# Outage drill

Principle 5: **nothing fails silently.** Every job ends in a result or a named failure, and that failure reaches the creator (if they're waiting) or the operator. The drill checks this against the failures vendors really have, one fault × flow cell at a time, on the real code paths.

- Fault switch: `convex/eval/faults.ts` (a thin guard at each vendor boundary)
- Runner and report: `convex/eval/outageDrill.ts`
- Deterministic versions (fake model + spec fixtures, run in CI): `convex/eval/__tests__/outageDrill.test.ts`, `faults.test.ts`, `outageFixes.test.ts`

## What the fault switch can and can't touch

A fault fires only when **all** of these hold. Each one is checked where the fault is read, and if anything is missing, no fault fires:

1. `ENVIRONMENT_NAME` is set, is not `production`, and the deployment URL is not prod (`resilient-mandrill-621`). In production the check is a single env comparison: no query, no read.
2. The `syncState` row `eval:faults` exists and hasn't expired. The TTL is capped at 2 h, and the drill sets 20 min per cell and clears the row after every cell.
3. The call names a creator, that creator is listed in the row, and the creator is an eval creator: an `eval:` or `eval-run:` subject with no phone and no Telegram chat. These are the only creators whose messages are never delivered (`core/messages.ts`).

When a fault is on, the real client runs against a fetch that fails the way the vendor does: the same status and the same body shape. That means the real retries, error types, cache writes and messages are what gets measured. OpenRouter is the one exception, because its client takes no fetch. `callModel` returns the client's own 5xx or timeout reason and still writes the ledger row.

| Fault | Boundary | What the vendor sends |
|---|---|---|
| `scrape_402` / `scrape_429` / `scrape_500` / `scrape_timeout` | `reads/read.ts` (every TikTok and Instagram read) | 402 out of credits · 429 with `retry-after: 0` · 500 · abort |
| `gemini_overload` / `gemini_timeout` | `agent/opinion.ts watchBytes` (both models), `agent/moment.ts kindOfMedia` | 503 "The model is overloaded" · TimeoutError |
| `writer_5xx` / `writer_timeout` | `core/llm.ts callModel`, the writer's primary and fallback models only | `openrouter 503: …` · `openrouter timed out` |
| `classifier_5xx` / `classifier_timeout` | `core/llm.ts callModel`, `purpose: classify*` only | same |
| `zernio_5xx` | `connections/insightsSync.syncCreator` | 503 (the client retries 3× with real backoff) |
| `tavily_5xx` | `agent/web.ts` search/read, `partnerships/research.ts` | 502 |
| `gmail_5xx` | `partnerships/delivery.send` | 503 |

A read under a fault uses its own cache kind (`drill:<kind>`). The real claim, fail and remember code runs on those rows, but a remembered drill failure can never answer a real creator's read of the same key.

Health rows written by a pass that ran under a fault get a `:drill` suffix on their check name. They show on `/ops`, but the hourly operator alert and the creator status message both skip them. So the drill never sends a real Telegram alert, and it never tells real creators "couldn't see tiktok today". The report asks `alerts.findings {includeDrill: true}` what the operator would have been told.

## Scenarios and flows

The scenarios are each of the 13 faults on its own, plus `bad_day`. `bad_day` runs 402, Gemini overload, writer 5xx, classifier timeout, Zernio, Tavily and Gmail all at once, across every flow.

Every flow is the real function:

| Flow | How it runs | Someone waiting? |
|---|---|---|
| `text` | "what should i post this week?" through the real converse queue (enqueue with `maxAttempts: 1`, so the dead letter is reached in one attempt) | yes |
| `tiktok_link`, `instagram_link` | "why did this blow up <link>" through the queue | yes |
| `finish` | a camera-roll draft (a stored clip as their file message) through the queue | yes |
| `scout` | `scout.run` on one fresh breakout per platform (paired for the cell only) | no |
| `sampler`, `sweep` | `sampler.run` / `sweep.run` scoped to the drill creator (TikTok and Instagram) | no |
| `analytics` | `insightsSync.syncCreator` on a temporary Zernio connection (TikTok and Instagram) | no |
| `web_search` | `agent/web.search` | no (a tool result) |
| `email_send` | `partnerships/delivery.send` of an approved pitch on the fake Gmail | yes |

Each scenario gets its own isolated creator, `eval-run:drill-<runId>-<scenario>`, with TikTok and Instagram handles and watched accounts on both. The email cell also needs `eval:partnership:drill-…`, which only exists on a local deployment with `EVAL_FAKES=1`. Without that, the email cells are reported as skipped.

## What each cell records, and what makes it pass

- **ended**: `result`, `named_failure` or `retry`. A cell fails if the job is `stuck` (still running after 5 min) or `silent` (no result and no named failure).
- **heard**: what the creator was told, found by that flow's dedupe keys. If they were waiting and heard nothing, the cell fails.
- **fakeSuccess**: the cell fails if any of these happen:
  - a prediction is written while the writer is down
  - captions are recorded without a watch
  - an idea goes out while the writer is down
  - an email draft is marked `sent` on a failed send, or the failed send isn't recorded as `unknown`
  - an insights row is written `ok` during a Zernio outage
  - a search reports `ok` while Tavily is down
- **operator**: dead jobs, `vendorHealth` failures (drill rows included) and failed model calls. The cell fails if a fleet job failed and neither the creator nor the operator was told. It also fails if **ScrapeCreators returned 402 and no `credit-balance` failure row was written**. Out of credits stops everything at once and only the operator can fix it.
- **duplicates**: the same body sent twice, or more than one email reaching the fake mailbox.
- **badCache**: a value stored during the failure, a fresh empty value, or an outage remembered as long as a missing account (over 10 min; `reads/cache.ts` keeps not-found for 24 h and everything else for 2 min).
- **wrongMarks**: a watched account retired, signals dropped because the writer was down, a connection status changed, or a 5xx stored as "not available".
- **reached**: whether the injected fault actually fired. A cell whose fault was never reached is `n/a`, not a pass.

## Running it on dev (the lead)

```sh
# 0. deploy this branch to the creator dev deployment
CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997 npx convex dev --once --typecheck disable
npx convex env get ENVIRONMENT_NAME        # must be set and not "production" (the drill refuses otherwise)
npx convex env get EVAL_FAKES              # "1" (plus ENVIRONMENT_NAME=local) enables the email cells

# 1. start (everything), or narrow it
npx convex run eval/outageDrill:start '{}'
npx convex run eval/outageDrill:start '{"scenarios":["scrape_402","bad_day"]}'
npx convex run eval/outageDrill:start '{"scenarios":["writer_5xx"],"flows":["text","tiktok_link"]}'
#   optional: "tiktokLink", "instagramLink" (otherwise the first post of the first watched account on each),
#   "watchedTiktok", "watchedInstagram", "keywords", "videoFileId" (an existing clip in storage)

# 2. read (repeat while it runs; each cell is its own scheduled action)
npx convex run eval/outageDrill:report '{"runId":"drill-…"}'
npx convex run eval/outageDrill:report '{"runId":"drill-…","cells":true}'   # full rows per cell

# 3. faults are cleared after every cell and at the end; to abort (and clear) at once:
npx convex run eval/outageDrill:stop '{"runId":"drill-…"}'
npx convex run eval/faults:current '{}'    # must show config: null afterwards
```

The report has a `summary` (pass / fail / n/a), a `matrix` (scenario → flow → `PASS`, `FAIL: why` or `n/a: why`) and `failures`, which lists each failing cell with what the creator heard and what the operator saw. At the end the drill creators are paused and unpaired, and their temporary connection is removed. Their rows are kept for the report.

To set faults by hand, for example to poke at one flow on a creator you made yourself:
`eval/faults:set {"faults":["scrape_402"],"creatorIds":["<eval creator id>"],"ttlMinutes":10}`, then `eval/faults:clear {}`. `set` refuses production, unknown faults and any creator that could be a person.

## Cost

It's small. Nearly every faulted call fails before reaching a vendor. What's left:

- **Setup:** up to 3 real ScrapeCreators reads (two account pages and one post.info) plus one video download. That's about 10 credits, unless you pass `tiktokLink`, `instagramLink` and `videoFileId`.
- **Cells with a single fault:** the other vendors are real. For example, a `gemini_overload` link cell makes real reads and a real writer call, and a `scrape_*` link cell makes a real writer call. Roughly $0.01–0.03 per cell in model spend, plus a few credits.
- **Full run:** about 60 cells (13 faults across the flows each can reach, plus `bad_day` across all 10 flows). Estimate under $1 in models and under 100 credits.
- **Time:** about 2 s between cells, plus up to 5 min per waiting turn at worst (usually seconds). Zernio's retries back off for real (about 1.5 s per read).

## What each cell proves

- **`scrape_402` (out of credits, which happened on dev on 2026-09-24):**
  - the first 402 writes a `scrapecreators/credit-balance` failure, so the operator's hourly alert fires and the creator status can apologise
  - a link gets "couldn't pull that post up just now. that's on my side", never "your link is private" and never vendor plumbing
  - the sampler and sweep end with a named failure and a health row
  - no watched account is retired
  - nothing is cached as empty, and the failure is remembered for 2 min, not a day
- **`scrape_429`, `scrape_500`, `scrape_timeout`:** the same checks, through the client's real retries and typed errors.
- **`gemini_*`:**
  - both watch models are tried, since the overload fallback runs
  - a hang now ends after 150 s instead of reaching the 10-minute action limit
  - a draft gets "couldn't watch that one just now. that's on my side", and no captions are recorded
- **`writer_*`:**
  - a text turn dies and the creator is told once (`turn-dead:<message>`)
  - a link read says "couldn't put a read together", and no prediction is written
  - the scout writes `openrouter/scout` for the operator, and its signals stay pending
- **`classifier_*`:** the fallback model is really asked, then the message is answered as plain chat.
- **`zernio_5xx`:** the insights pass writes a named `zernio/account insights` failure, and nothing is stored as ok or as "not available".
- **`tavily_5xx`:** web search returns a named `search unavailable (502)` to the model.
- **`gmail_5xx`:** the draft ends as `unknown`, never `sent`, and is never resent. The creator is told the send couldn't be confirmed.
- **`bad_day`:** all of the above at once, with no cell stuck, silent, duplicated or wrongly cached.
