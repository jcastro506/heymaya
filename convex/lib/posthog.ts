/**
 * Server-side PostHog capture — Wave 3 of the data-collection sprint.
 *
 * Convex actions run in a V8 isolate, NOT full Node, so `posthog-node` can't
 * run here. We POST directly to PostHog's capture API via fetch — works in
 * any action / httpAction. Used for SERVER-TRUTH events the client can't be
 * trusted to send: agent_deployed, agent_error, conversion, subscription
 * lifecycle, and the per-turn `$ai_generation` LLM-observability events.
 *
 * Best-effort + fail-open: capture never throws into the caller. If the key
 * is unset or PostHog is unreachable, we log and move on — telemetry must
 * never break a deploy or a webhook.
 *
 * `distinctId` should be the same identifier the browser SDK uses (the Clerk
 * user id, which is `creators.clerkUserId`) so server + client events stitch
 * onto one person. When only an accountId is available, pass
 * `account:<id>` — still consistent across server events for that account.
 */

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Capture one server-side event. Never throws. */
export async function capturePosthogEvent(args: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return; // analytics disabled — no-op
  try {
    const res = await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: args.event,
        distinct_id: args.distinctId,
        properties: {
          ...args.properties,
          $lib: "heymaya-convex",
        },
      }),
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({
          event: "posthog.capture_failed",
          status: res.status,
          phEvent: args.event,
        })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "posthog.capture_error",
        phEvent: args.event,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

/**
 * Emit a `$ai_generation` LLM-observability event for one Maya turn. PostHog
 * renders these natively in its LLM analytics views (cost, latency, token
 * dashboards) — no extra config. Maps our per-turn telemetry onto the
 * `$ai_*` property convention.
 */
export async function captureAiGeneration(args: {
  distinctId: string;
  turnId: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  costUsd?: number;
  accountId?: string;
}): Promise<void> {
  await capturePosthogEvent({
    distinctId: args.distinctId,
    event: "$ai_generation",
    properties: {
      $ai_trace_id: args.turnId,
      $ai_model: args.model,
      $ai_provider: "openrouter",
      $ai_input_tokens: args.tokensIn,
      $ai_output_tokens: args.tokensOut,
      $ai_latency: args.latencyMs != null ? args.latencyMs / 1000 : undefined,
      $ai_total_cost_usd: args.costUsd,
      account_id: args.accountId,
    },
  });
}
