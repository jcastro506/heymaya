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

// ─────────────────────────────────────────────────────────────────────────────
// PR 1 (ARCHITECTURE_OPENCLAW_NATIVE §2) — persistent-session chat turn.
//
// Founder DMs run in the agent's ONE durable `agent:main:main` session via the
// gateway's OpenAI-compatible endpoint (enabled per-deploy in
// buildGatewayConfig; auth = the per-agent hookToken, which the deploy also
// injects as OPENCLAW_GATEWAY_TOKEN). This is what gives Maya conversation
// memory. Deliberately NOT /hooks/agent: hooks are hardcoded isolated+forceNew
// in the runtime (verified in source 2026-07-15) — pointing one at the main
// session RESETS it, and hook bodies get wrapped in untrusted-content
// boundaries so the founder reads as a webhook, not as her user.
// ─────────────────────────────────────────────────────────────────────────────

/** A main-session chat turn can legitimately run minutes (tool use, steer-mode
 * queueing behind an active run). Convex actions allow 10; leave headroom. */
const CHAT_TURN_TIMEOUT_MS = 480_000;

export interface MainSessionChatResult {
  ok: boolean;
  status: number;
  /** The agent's reply text (the turn's final message). */
  text?: string;
  error?: string;
  /** True when the failure was a timeout — the turn may still be RUNNING on
   * the machine, so callers must NOT retry (a retry re-injects the founder's
   * text into the session as a duplicate). */
  timedOut?: boolean;
}

export async function runMainSessionChat(
  endpoint: HookEndpoint,
  args: { text: string; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch
): Promise<MainSessionChatResult> {
  // endpoint.baseUrl is the /hooks surface; the OpenAI-compat API lives at
  // the gateway root on the same multiplexed port.
  const root = endpoint.baseUrl.replace(/\/$/, "").replace(/\/hooks$/, "");
  const url = `${root}/v1/chat/completions`;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeoutMs = args.timeoutMs ?? CHAT_TURN_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${endpoint.token}`,
        // Explicit durable session — the whole point of this path.
        "x-openclaw-session-key": "agent:main:main",
        // Channel context for channel-aware prompt sections.
        "x-openclaw-message-channel": "telegram",
      },
      body: JSON.stringify({
        model: "openclaw/main",
        messages: [{ role: "user", content: args.text }],
        stream: false,
      }),
      signal: controller?.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `chat completions ${res.status}: ${raw.slice(0, 300)}`,
      };
    }
    let content: string | undefined;
    try {
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = parsed.choices?.[0]?.message?.content ?? undefined;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: `chat completions: non-JSON response: ${raw.slice(0, 200)}`,
      };
    }
    return { ok: true, status: res.status, text: content };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const timedOut =
      (err as Error).name === "AbortError" || /abort/i.test(message);
    return {
      ok: false,
      status: 0,
      timedOut,
      error: `chat completions fetch failed: ${message}`,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Generate a fresh hook token. Called once per agent at deploy and stored
 * on `gtmAgents.hookToken`. Treated as a shared secret; never exposed to
 * unauthenticated clients.
 */
export function mintHookToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary)
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
