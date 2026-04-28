# Unipile integration

Covers the LinkedIn surface Composio doesn't: DMs, profile search,
post-comment-text, profile-feed watch, connection requests.

## Why we need this

Composio's LinkedIn integration uses LinkedIn's **official OAuth API**.
That's great for posting (low ban risk) but LinkedIn partner-gates the
APIs Riley needs for DMs / search / engagement read. We can't get those
self-serve. Unipile's authenticated-session backend exposes them as a
clean REST API. Trade-off: real flag risk if used aggressively (>20 DMs/day,
shared session, batch-send patterns). Operator-side rate limits + approval
gates keep this safe — see `docs/RILEY_GROWTH_PLAN.md` § "Locked safety rules".

## Operator setup (one-time)

1. Sign up at https://www.unipile.com/. Pro tier $59-99/mo.
2. From the Unipile dashboard, create a LinkedIn-account "session" by
   logging into Josh's LinkedIn (NOT a shared session — give it a
   dedicated browser fingerprint).
3. Capture three values:
   - `UNIPILE_API_KEY` — account-scoped X-API-KEY
   - `UNIPILE_DSN` — regional DSN, e.g. `api3.unipile.com:13335`
   - `UNIPILE_LINKEDIN_ACCOUNT_ID` — the session id Unipile assigns
4. Add all three to `.env.local` AND Convex env (so deployed Riley can
   read them as Fly secrets).
5. Optional: upgrade Josh's LinkedIn to Sales Navigator if Unipile's
   profile-search returns thin results without it (~$99/mo). Test
   without first.

## Status

**Wave A (current commit):** typed surface + zod validators only. Every
client method throws `UnipileError("not implemented")`. The interface is
locked here so Riley's pack-level skills can import + use it without
waiting on the live HTTP wiring.

**Wave B (next):** replace the stubs with real `fetch` calls, response
parsing via the existing zod schemas, structured error mapping, retry
on 429. Add tests against recorded fixtures (don't hammer Unipile in CI).

**Out of scope for v0:** `connection.send_request` — too easy to trip
LinkedIn's "automated outreach" detector. Manual only until we have
account-flag experience to size the risk.

## Imports

```ts
import {
  UnipileClient,
  UnipileError,
  type ProfileSearchParams,
  type SendMessageParams,
  type ListChatsParams,
  type ListPostCommentsParams,
  type ListUserPostsParams,
} from "@/convex/integrations/unipile/client";

const unipile = new UnipileClient({
  // env vars used by default:
  //   UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_LINKEDIN_ACCOUNT_ID
});
const results = await unipile.profileSearch({
  title: "VP of Marketing",
  industries: ["software", "saas"],
  limit: 25,
});
```

## What this is NOT

- Not a multi-tenant LinkedIn-account router. Riley deploys one LinkedIn
  account per Fly machine (Josh's). The `accountId` parameter exists for
  future multi-account but v0 uses one.
- Not Composio. Composio is the "official OAuth API" path for posting +
  comments. Unipile is the "authenticated session" path for DMs + search.
  Both clients live in the codebase; Riley's skills decide which to call
  per action. See `convex/integrations/composio/actions/linkedin.ts` for
  the Composio side.
- Not a scheduling tool. Unipile sends NOW; if we want scheduled posts
  later we'd add Buffer / Late as a separate integration.
