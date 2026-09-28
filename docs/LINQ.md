# Linq: Maya on iMessage, RCS and SMS

Maya texts people from a real phone number through [Linq](https://docs.linqapp.com/channel/imessage/) (Partner API v3). This was built on 2026-09-28 from Linq's public docs and OpenAPI contract, **before we had an account**. Every request and webhook shape is from the docs and tested against a faked HTTP layer. The first live send is the exit criterion.

Claw (a Linq reseller) still works as before. Linq takes over as soon as `LINQ_API_KEY` is set on a deployment (`phoneVendor()` in `convex/core/imessage.ts`).

## Turn it on (per deployment; staging first)

1. Sign up at Linq, generate an API token at `dashboard.linqapp.com/api-tooling`, and ask your rep for a line (or several).
2. Set the key yourself. Never paste it anywhere else:
   ```sh
   CONVEX_DEPLOYMENT=dev:precise-canary-781 npx convex env set LINQ_API_KEY <token>
   ```
3. Deploy the code (`npm run convex:staging`), then run the one-command setup:
   ```sh
   node scripts/linq-setup.mjs --deployment dev:precise-canary-781 --photo https://<a square photo of Maya>
   ```
   It lists your lines and creates the webhook subscription at `https://precise-canary-781.convex.site/linq/webhook?version=2026-02-03`. It stores the signing secret straight into `LINQ_WEBHOOK_SECRET` without showing it, and sets her contact card (name and photo) on every line.
4. Optional: `LINQ_LINE_NUMBER` is a fallback for the pairing screen, used if Linq's pick for a new person hasn't landed yet. The script prints the command.
5. Test: sign up with your own number, text `START …` from the pairing screen, and watch `npx convex logs`.

| Env | Required | What |
|---|---|---|
| `LINQ_API_KEY` | yes | Bearer token. Set it yourself. |
| `LINQ_WEBHOOK_SECRET` | yes | `whsec_…`, set by the script from the subscription. |
| `LINQ_LINE_NUMBER` | no | Pairing-screen fallback line. |
| `LINQ_BASE_URL` | no | Defaults to `https://api.linqapp.com/api/partner`. |

Once any `LINQ_*` is set, `smoke` checks the config and a half-set config reaches the hourly alert.

## The free tier (Shared Line) for the pilot

`linq signup` (Linq CLI 2.6+, Node 22+) creates a free **Shared Line**: one Linq Number, **20 contacts max**, and **inbound-first**, so a contact must be added and must text the line before Maya can text them. That fits our pairing (they text `START` first), so it's enough for you, your girlfriend and a few pilots. What to do differently from the paid setup:

1. You run the signup and the contact adds yourself (`linq signup --email …`, then `linq whoami`, then `linq contacts add +1<their number>` for each person before they text). Maya can't create the account, and the contact add isn't in the public REST API, so it isn't automated.
2. Set the line as the pairing fallback, because `available_number` is a paid-line feature: `npx convex env set LINQ_LINE_NUMBER <the number from linq whoami>`.
3. `LINQ_API_KEY` is `linq tokens show` (or from the dashboard). Set it on the deployment yourself; don't paste it into chat.
4. Then `node scripts/linq-setup.mjs --deployment dev:precise-canary-781`. Setting the contact card may be refused on a shared line; the script says so and carries on.
5. Linq's error `2008` ("recipient not allowed") means that person hasn't texted the line yet. It's a named, non-retryable failure on the row, not an opt-out. The sandbox also has a daily and a per-minute cap (429 with Retry-After).

Past 20 contacts, or for a line that's only ours, ask Linq for a dedicated line.

## Linq's best practices, and where each one is kept

Their docs ship an audit prompt (Best Practices → "Review your setup with an agent"). Every item is below.

| Linq asks | Where |
|---|---|
| Send with `POST /v3/messages` and **no `from`**, so Linq picks the line, reuses the chat's line, and fails over off a flagged one | `integrations/linq/client.ts` `sendBody`, `sendMessage`. A test asserts no `from`. |
| `GET /v3/available_number` only when onboarding a new person, never per message | `core/imessage.registerPhone` (when they enter their number) stores `channel.line`, which the pairing screen shows |
| An `idempotency_key` on every send | `<messageId>:<part>` per text. A retried delivery job can't text twice. |
| One text part per message (consecutive text parts are rejected) | `deliverLinq`: one message per part, with a 900 ms gap |
| Inbound-first; no links or media in the first message | Pairing is them texting `START`. The unknown-number reply no longer carries a link. |
| Contact card: create once per line, share after the first outbound, at most once a day | `scripts/linq-setup.mjs`; `deliverLinq` shares it when `cardSharedAt` is more than 24 h old |
| Opt-out keywords (`STOP`, `UNSUBSCRIBE`, `OPTOUT`, `CANCEL`, `END`, `QUIT`, "opt out"): whole message, exact case | `isOptOutKeyword` → `optedOutAt`, one goodbye with `override_optout: true` (never in a loop), and no turn. Any later text lifts it. "please stop" in a sentence is the classifier's pause. |
| A `2024` refusal is honoured, never retried | `classifyError` → `opted_out`; `deliverLinq` marks the creator |
| Gate sends on the chat's `health_status`: slow at AT_RISK, pause at CRITICAL, never at OPTED_OUT | `core/phoneRail.ts`, held inside `messages.send` beside the daily cap (no caller can skip it). Health is cached from every webhook and send. |
| Handle `phone_number.status_updated`: page on FLAGGED, slow on AT_RISK/CRITICAL | `imessage/linqEvents.line` keeps line state for the rail and writes a failing `vendorHealth` row, which the hourly operator alert already reports |
| Let replies set the pace: no reply → about a day → one follow-up → a few days → one more → a last message with an easy way out → stop | `phoneRailHold`'s silence ladder. The last message is her existing "quiet" check-in. |
| Keep lines under ~7,000 messages a day, and don't open ~50+ new chats per line per day | Structurally far below: the daily cap is 3 proactive texts per person, and signups come one at a time |
| Webhooks: Standard Webhooks HMAC over the raw body, a 5-minute replay window, constant-time compare, answer fast, dedupe on redelivery | `verifyWebhook`, `imessage/linqWebhook.ts` (schedules the work). Messages dedupe by message id, reactions by event id. |
| Pin the webhook payload version | `?version=2026-02-03` in the subscription URL |
| 429 with `Retry-After`; `2027`/`409` means no line can send right now | `classifyError` → retryable, with the wait named on the row |
| Typing while composing (lasts about 90 s per start) | `core/imessage.typing`, scheduled when their text arrives, like Telegram's |
| Media: at most 10 MB by URL; inbound files come as `cdn.linqapp.com` URLs | Storyboard frames are small images sent by URL. Inbound photos and videos go through the existing `bigMedia.fetchToStorage` (150 MB guard). |

## Decided in code; worth your review

- **The silence ladder changes her cadence on a phone.** If someone doesn't reply, the next proactive text waits about a day, then 3 days. After three unanswered texts only the "quiet" check-in may go, and then nothing until they write. A reminder for a shoot they booked may still go after one unanswered text. On Telegram nothing changes.
- **At AT_RISK she sends one proactive text a day.** At CRITICAL, or when the line is flagged, she sends none until it recovers. Replies to them are never held.
- **Her "quiet" check-in is the last message.** Linq suggests it offer an easy way out ("want me to stop?"). Her current wording is a warm "still here, no pressure" that asks nothing. Your call whether to add "say pause and I'll go quiet".
- **Not built:** zero-day retention (Linq can keep inbound media for only 24–48 h; we already copy files to our storage at once), SMS/RCS-specific formatting (Linq falls back on its own; tapbacks and typing are iMessage-only), and Apple Messages for Business (Linq also offers it: the official, inbound-first lane our research named as the long-term path).

## Proven live on dev, against a fake Linq (2026-09-28)

`convex/eval/fakeLinq.ts` is a Linq that behaves as its docs say, served by the deployment itself. It refuses `from`, refuses consecutive text parts, returns the original send for a repeated idempotency key, and refuses a STOPped recipient with 403/2024 unless `override_optout` is set. It answers only with `EVAL_FAKES=1` on a local deployment. `eval/fakeLinq:e2e` runs the whole loop through the real webhook route, the real turn and the real delivery path. **9 of 9 pass:**

signed text accepted · her reply sent through Linq · typing shown · contact card offered once · a key on every send · STOP gets one goodbye with the override · a proactive text is then held · their next text lifts it and she answers · the chat and line are recorded on the creator.

```sh
export CONVEX_DEPLOYMENT=dev:impressive-roadrunner-997        # dev only; the run refuses otherwise
npx convex env set LINQ_API_KEY fake-linq
npx convex env set LINQ_BASE_URL https://impressive-roadrunner-997.convex.site/fake/linq
npx convex env set LINQ_WEBHOOK_SECRET "whsec_$(openssl rand -base64 32)"
npx convex run eval/fakeLinq:e2e '{}'
```

Its creator has a fictional 555-01xx number and no handles (so no fleet job spends credits on it), and is unpaired at the end.

## Tests

`convex/imessage/__tests__/linq.test.ts` covers the client against the documented shapes, an independent HMAC vector, the keyword list, error mapping, and the rail ladder. It also runs the rows end to end: delivery (no `from`, a key per part, card once a day), `2024`, `STOP`, and the signed webhook through her turn to a reply sent through Linq. It checks redelivery, forged and stale signatures, cross-tenant health, the flagged-line alert, and that a Telegram creator never meets the rail.
