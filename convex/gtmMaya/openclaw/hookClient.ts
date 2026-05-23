/**
 * Sprint 16 — Convex → Maya bridge (D4 of CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md).
 *
 * OpenClaw exposes a canonical webhook surface at `<gateway>/hooks/*` for
 * external callers (us) to wake an agent, queue an agent turn, or fire a
 * custom hook. Per https://docs.openclaw.ai/automation/cron-jobs#webhooks:
 *
 *   - POST /hooks/agent — run isolated agent turn. Body:
 *     { message, agentId?, deliver?, channel?, to?, model?, thinking?,
 *       timeoutSeconds? }
 *   - POST /hooks/wake — wake heartbeat with a system event. Body:
 *     { text, mode: "now" | "next-heartbeat" }
 *   - POST /hooks/<name> — custom hook with payload mapping.
 *
 * Auth: `Authorization: Bearer <hookToken>` OR `x-openclaw-token: <token>`.
 * Tokens are per-agent (provisioned at deploy in Sprint 16, see
 * patchGtmAgentOnHookProvision). Query-string tokens are rejected.
 *
 * This file is the typed Convex client. Callable from Convex actions
 * only — never from queries or mutations (Convex queries/mutations can't
 * make outbound HTTP).
 */

import type { Id } from "../../_generated/dataModel";

const FETCH_TIMEOUT_MS = 10_000;

export interface RunAgentTurnArgs {
  /** The prompt Maya will receive as an isolated-session turn. */
  message: string;
  /** Optional. Targets a specific agent if the gateway has multiple. */
  agentId?: string;
  /** When true, OpenClaw delivers the agent's final text via the
   *  configured channel adapter if the agent didn't proactively send. */
  deliver?: boolean;
  /** Channel name (must match the gateway's bindings). */
  channel?: "telegram" | "whatsapp" | "imessage" | "slack" | "discord";
  /** Recipient address — telegram chat id, phone number, etc. */
  to?: string;
  /** Optional model override. Must be in the agent's allowlist. */
  model?: string;
  /** Thinking budget hint. */
  thinking?: "off" | "low" | "medium" | "high";
  /** Timeout for the turn. Defaults to gateway config. */
  timeoutSeconds?: number;
}

export interface WakeHeartbeatArgs {
  text: string;
  mode?: "now" | "next-heartbeat";
}

export interface HookEndpoint {
  /** Fully-qualified base URL of the OpenClaw gateway hooks surface,
   *  e.g. "https://maya-gtm-abc.fly.dev/hooks". */
  baseUrl: string;
  /** Per-agent shared secret used in Authorization: Bearer <token>. */
  token: string;
}

export interface HookResponse {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

/**
 * Fire a Convex → Maya agent turn. Returns when the gateway has accepted
 * the run (not when the turn completes). Errors surface as { ok: false }
 * so callers can decide retry policy.
 */
export async function runAgentTurn(
  endpoint: HookEndpoint,
  args: RunAgentTurnArgs,
  fetchImpl: typeof fetch = fetch
): Promise<HookResponse> {
  return await postHook(endpoint, "/agent", args, fetchImpl);
}

/**
 * Wake an agent's heartbeat lane with a system event. Lighter-weight than
 * a full agent turn: the agent's existing heartbeat loop picks it up.
 */
export async function wakeHeartbeat(
  endpoint: HookEndpoint,
  args: WakeHeartbeatArgs,
  fetchImpl: typeof fetch = fetch
): Promise<HookResponse> {
  return await postHook(endpoint, "/wake", args, fetchImpl);
}

async function postHook(
  endpoint: HookEndpoint,
  path: "/agent" | "/wake",
  body: unknown,
  fetchImpl: typeof fetch
): Promise<HookResponse> {
  const url = `${endpoint.baseUrl.replace(/\/$/, "")}${path}`;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.token}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
      error: res.ok
        ? undefined
        : `hook ${path} returned ${res.status}: ${typeof parsed === "string" ? parsed : "non-2xx"}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `hook ${path} fetch failed: ${(err as Error).message}`,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Compute a derived hook base URL from a Fly app name. Used at deploy to
 * compute where the agent is reachable.
 */
export function deriveHookBaseUrl(flyAppName: string): string {
  return `https://${flyAppName}.fly.dev/hooks`;
}

/**
 * Generate a fresh hook token. Called once per agent at deploy and stored
 * on `gtmAgents.hookToken`. Treated as a shared secret; never exposed to
 * unauthenticated clients.
 */
export function mintHookToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Build the canonical hook payload for "research job phase completed".
 * Sprint 16 standard format: tell Maya which job finished, what phase
 * advanced, and where she can read the new evidence. Maya reads
 * APP.md/GTM.md (refreshed by workspace mutation in S19) and the new
 * gtmEvidenceCards.
 */
export function buildResearchPhasePrompt(args: {
  researchJobId: Id<"gtmResearchJobs">;
  phase: string;
  newEvidenceCount?: number;
}): string {
  const evidence = args.newEvidenceCount
    ? ` Added ${args.newEvidenceCount} new evidence card(s).`
    : "";
  return (
    `RESEARCH UPDATE: Job ${args.researchJobId} advanced to phase "${args.phase}".${evidence} ` +
    `Read PLAYBOOK.md (master doctrine), then APP.md and GTM.md (just refreshed by the research worker), ` +
    `then the new evidence in gtmEvidenceCards for this job. Decide whether to: (1) queue a follow-up ` +
    `bounded research task with explicit budget, (2) draft a single concise update to the user via the ` +
    `configured channel (HEARTBEAT_OK if nothing user-visible changed), or (3) update DREAMS.md with a ` +
    `learning. Pick one and explain which playbook rule applies. Do not spend ScrapeCreators / Gemini / ` +
    `Composio budget from this turn — that's a separate bounded job.`
  );
}
