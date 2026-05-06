# Admin-flagged comp accounts

Sprint 9. Operator path for onboarding friend-cohort beta testers without
making them swipe a Stripe card.

## What it does

Flips `creators.compedByAdmin = true` on a creator row. Once flipped:

- `planFeatures(creator)` returns the **Manager** feature set regardless
  of the stored `plan` field. (Implemented in
  `convex/lib/planFeatures.ts`.)
- `subscriptionActive(creator)` returns `true` regardless of Stripe
  state. (Same file.)
- The creator gets unlimited chat, full proactive cron set, brand-deal
  autonomy, Apollo/Hunter discovery — everything Manager-tier ships.

The flag is persistent. It survives webhook events; only `uncompCreator`
clears it.

## Setup (once)

Generate a 32-byte hex token:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set it on the Convex deployment:

```sh
npx convex env set ADMIN_TOKEN <hex>
```

Do **not** put `ADMIN_TOKEN` in `.env.local` or `.env.production` — it
should only live in the Convex env. The frontend has zero need to call
the admin surface.

## Comp a creator

After they sign up via the live UI (so a `creators` row exists), look up
their `creatorId` (Convex dashboard, `creators` table, copy the row id
column), then run:

```sh
npx convex run admin:compCreator '{"token":"<hex>","creatorId":"<id>"}'
```

Response:

```json
{ "ok": true, "alreadyComped": false }
```

`alreadyComped: true` means the call was a no-op (idempotent — re-running
is safe).

## Un-comp a creator

```sh
npx convex run admin:uncompCreator '{"token":"<hex>","creatorId":"<id>"}'
```

After this, the creator's plan-tier reverts to whatever `plan` +
Stripe state say. Typically the paywall, unless they have an active
subscription.

## Verifying the flip took

In the Convex dashboard, open the `creators` table, find the row, and
confirm `compedByAdmin` is `true`. Then in the running app, log in as
that creator and verify Manager-only surfaces (e.g. brand-outreach
discovery, cold-pitch composer) are accessible.

## Failure modes

- **`unauthorized`** — the token in the call body doesn't match
  `ADMIN_TOKEN` in Convex env. Check both sides.
- **`creator-not-found`** — the creatorId is wrong (or the row was
  deleted). Look it up again in the Convex dashboard.

## Why this exists

Friend-cohort beta cohort = ~10 friends. Stripe + checkout + trial-
expiration logic is not the point of beta — the point is whether Maya
ships a real morning brief. Comp accounts skip the Stripe surface
entirely so the operator can focus the beta on the agent quality, not
the payment flow.

When the friend cohort moves to paid tier (or churns), `uncompCreator`
makes the transition clean.
