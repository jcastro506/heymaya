/**
 * Shared-secret gate for "public wrapper around an internal handler" pattern.
 *
 * Why this exists: the Next.js webhook routes (`app/api/composio/webhook/route.ts`,
 * `app/api/billing/stripe-webhook/route.ts`, `app/api/clerk/webhook/route.ts`)
 * use `ConvexHttpClient` to dispatch to handlers. ConvexHttpClient cannot call
 * `internal.*` references — that namespace is reserved for Convex→Convex calls
 * (TypeScript flags it as TS2345 because the public surface only accepts
 * `"public"`-typed FunctionReferences).
 *
 * The fix is to expose a thin `public` wrapper next to each internal handler
 * that delegates inward. But "public" on Convex means "callable from anyone
 * who can reach our deployment URL" — which is the entire internet. Without
 * an additional gate, anyone could spoof a webhook payload by calling the
 * wrappers directly.
 *
 * `assertWebhookSecret(provided)` enforces the gate. It compares the caller-
 * supplied secret against `WEBHOOK_INTERNAL_SECRET` (set in BOTH Next.js env
 * and Convex env — they MUST match). Constant-time comparison prevents
 * timing attacks; a missing or mismatched secret throws.
 *
 * Operator setup:
 *   1. Generate a strong secret (32+ bytes random):
 *        `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`
 *   2. Add `WEBHOOK_INTERNAL_SECRET=<hex>` to `.env.local` (used by Next.js).
 *   3. `npx convex env set WEBHOOK_INTERNAL_SECRET <hex>` (used by Convex).
 *   4. Restart `next dev` and `npx convex dev`.
 *
 * Failure mode if missing: `assertWebhookSecret` throws on every wrapper call,
 * which makes the webhook routes return 200 with a `{ error: "..." }` body
 * (Stripe/Composio retry on 4xx/5xx, so we always return 200 — but the
 * upstream operator dashboard surfaces the failures via `*WebhookEvents`
 * audit-log rows that get an `errored` status). The fail-closed default is
 * exactly what we want: until the secret is set, the public wrappers refuse
 * every call.
 */

/**
 * Constant-time string compare. Returns `true` iff the strings are equal.
 * NEVER short-circuit on length mismatch beyond the trivial guard — leaking
 * length is a timing oracle, but Convex env values are operator-supplied and
 * not user-derived, so the length leak is acceptable here.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Throws an error if the provided secret does not match the env-configured
 * `WEBHOOK_INTERNAL_SECRET`. The error message is intentionally vague to
 * avoid hinting at whether the secret is unset vs mismatched — both look the
 * same to the caller.
 *
 * Tests: `_setWebhookSecretForTests(value)` injects a fake secret so the
 * convex-test runtime (which has no `process.env`) can verify the gate
 * without operator setup. ALWAYS reset to `null` in `afterEach`.
 */
let __injectedSecret: string | null = null;

export function _setWebhookSecretForTests(secret: string | null): void {
  __injectedSecret = secret;
}

export function assertWebhookSecret(provided: string | undefined): void {
  const expected = __injectedSecret ?? process.env.WEBHOOK_INTERNAL_SECRET;
  if (!expected || expected.length === 0) {
    throw new Error("Webhook bridge unauthorized.");
  }
  if (typeof provided !== "string" || provided.length === 0) {
    throw new Error("Webhook bridge unauthorized.");
  }
  if (!constantTimeEqual(expected, provided)) {
    throw new Error("Webhook bridge unauthorized.");
  }
}
