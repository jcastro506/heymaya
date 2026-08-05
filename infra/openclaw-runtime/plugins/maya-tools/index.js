// maya-tools — typed OpenClaw tools for the `convex/maya` agent.
//
// WHY THIS EXISTS
// ---------------
// The alternative is the model hand-writing `curl` through `exec`, which is
// OpenClaw's fallback path and which failed on the live machine in three
// distinct ways: missing required JSON fields (Convex 400s), shell-quoting
// errors, and — the worst one — small research workers that never attempted the
// curl at all, found nothing, and FABRICATED the result.
//
// A typed tool closes that last hole structurally. The data exists only if the
// call actually ran, so there is nothing to fabricate from.
//
// TWO PROPERTIES THIS FILE MUST PRESERVE
// --------------------------------------
// 1. NO TOOL ACCEPTS A customerId. Tenancy is resolved server-side from the
//    bearer token alone. Adding a tenant parameter here would hand the model
//    the ability to name an account it isn't, and re-open the exact class of
//    bug the server surface was shaped to eliminate. A test asserts no schema
//    contains one.
//
// 2. THE ENVELOPE IS PASSED THROUGH VERBATIM. The server answers
//    `{ok, data, next, why}` and the model needs all four — especially `next`,
//    which is what stops it retrying a decision that will never change. Do not
//    reshape, summarize, or unwrap it. A tool that returns only `data` silently
//    deletes the choreography.
//
// Authored as plain ESM (no build step). Installed via
// `openclaw plugins install npm-pack:<tgz>` at boot; activates onStartup so the
// tools are registered before the gateway serves a turn.

import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function readEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function baseUrl() {
  const base = readEnv("CONVEX_SITE_URL", "CONVEX_URL");
  return base ? base.replace(/\/+$/, "") : undefined;
}

/**
 * The agent's own credential.
 *
 * Deliberately NOT `HOOK_TOKEN` — that is the frozen v1 pack's variable, and a
 * machine mid-migration can carry both. Separate name, separate credential,
 * separate blast radius.
 */
function agentToken() {
  return readEnv("MAYA_AGENT_TOKEN");
}

/**
 * A missing environment variable is a NAMED failure in the envelope shape, not
 * a thrown error and not silence.
 *
 * It reaches the model as something it can say out loud rather than as a stack
 * trace it will try to interpret — and `next` tells it to stop rather than
 * retry, because no amount of retrying will conjure an env var.
 */
function envFailure() {
  const missing = [];
  if (!baseUrl()) missing.push("CONVEX_SITE_URL");
  if (!agentToken()) missing.push("MAYA_AGENT_TOKEN");
  if (missing.length === 0) return undefined;
  return {
    ok: false,
    why: `this machine can't reach the server — missing ${missing.join(", ")}`,
    next: "stop and tell the operator; retrying will not fix this",
  };
}

/**
 * POST to a /maya/* route and return the envelope UNTOUCHED.
 *
 * Every failure path also produces an envelope, so the model's contract is the
 * same whether the call succeeded, was refused, or never left the machine. A
 * transport that sometimes returns an envelope and sometimes returns an
 * exception forces the model to handle two shapes, and it will get one wrong.
 */
async function call(route, payload, signal) {
  const failure = envFailure();
  if (failure) return failure;

  let response;
  try {
    response = await fetch(`${baseUrl()}/maya/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${agentToken()}`,
      },
      body: JSON.stringify(payload ?? {}),
      signal,
    });
  } catch (error) {
    return {
      ok: false,
      why: `couldn't reach the server: ${error?.message ?? String(error)}`,
      next: "wait and try once more; if it fails again, tell the operator",
    };
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    // Pass through verbatim — including `next`, which is the whole point.
    if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
    return {
      ok: false,
      why: `the server sent something unexpected (HTTP ${response.status})`,
      next: "stop and tell the operator — do not guess at what it meant",
    };
  } catch {
    return {
      ok: false,
      why: `the server sent a non-JSON reply (HTTP ${response.status})`,
      next: "stop and tell the operator — do not guess at what it meant",
    };
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export default defineToolPlugin({
  id: "maya-tools",
  name: "Maya Tools",
  description:
    "Typed tools for the convex/maya agent. Every call is schema-validated and runs server-side against Convex /maya/*. No tool accepts a customerId — tenancy is resolved from the bearer token alone.",
  tools: (tool) => [
    tool({
      name: "scroll",
      label: "Scroll",
      description:
        "Read what's actually moving in the niche right now. RUN THIS BEFORE WRITING ANYTHING — a post written without it comes from product truth alone, which is the same post every day. Takes no arguments; the niche is already known from the founder's account. Returns observations ranked by VELOCITY (engagement over age), so the top of the list is what's climbing, not what's already big. ok:true with an empty list is a real answer: the niche is quiet, and saying so beats posting filler. Pick ONE observation worth answering and draft to that specific person or moment — never to the topic.",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) => call("scroll", p, ctx.signal),
    }),

    tool({
      name: "draft",
      label: "Draft",
      description:
        "Write a post down. THE ONLY WAY TEXT BECOMES POSTABLE — publish takes a draftId, so a sentence that was never drafted cannot be posted no matter how good it is. Returns {ok, data, next, why}; data.draftId is what publish needs. ok:false is an ANSWER you can act on immediately, not an error: data.problem names what's wrong (over_length · empty · channel_missing · token_expired · duplicate) and `why` says it in the founder's language. Fix it and save again. Save the text EXACTLY as it should appear — this is what the founder sees and what gets published, character for character.",
      parameters: Type.Object({
        text: Type.String({
          description:
            "The post, exactly as it should appear. No surrounding quotes, no commentary, no explanation of the post.",
        }),
        channel: Type.String({
          description: "Which channel this is for: x, instagram, tiktok, or youtube.",
        }),
        kind: Type.Optional(
          Type.String({
            description:
              "post (default), reply, or cold_reply. A reply answers someone; a cold_reply starts a conversation with a stranger.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("draft", p, ctx.signal),
    }),

    tool({
      name: "publish",
      label: "Publish",
      description:
        "Publish an approved draft to its channel. THE ONLY WAY TO POST. Pass draftId; set alreadyApproved when the founder has said yes to THIS draft in chat or tapped it. Returns {ok, data, next, why}. ok:false with data.holdReason is a real ANSWER, not an error — the post is held for a named reason (show_me_first · safety_floor · channel_unavailable · tiktok_preview_consent). Relay `why` to the founder in their language and DO NOT RETRY. ok:true means cleared and queued; the placement row with its URL is the proof it went live, so do not announce it as posted yet.",
      parameters: Type.Object({
        draftId: Type.String({
          description: "The draft to publish. It carries the exact text the founder saw.",
        }),
        alreadyApproved: Type.Optional(
          Type.Boolean({
            description:
              "True only when the founder approved THIS draft. Their words in chat count exactly as much as a tap.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("publish", p, ctx.signal),
    }),

    tool({
      name: "reply",
      label: "Reply",
      description:
        "Send a reply to a comment, mention, or thread. Pass draftId and inReplyTo (the platform id of the thing being replied to). Goes through the same publish decision as a post — same hold reasons, same rule that ok:false with a holdReason means relay it and do not retry. Inbound outranks outbound: answer people before writing anything new.",
      parameters: Type.Object({
        draftId: Type.String({ description: "The reply draft." }),
        inReplyTo: Type.String({
          description: "Platform id of the comment, mention, or post being replied to.",
        }),
        alreadyApproved: Type.Optional(Type.Boolean()),
      }),
      execute: async (p, _cfg, ctx) => call("reply", p, ctx.signal),
    }),

    tool({
      name: "checkpoint",
      label: "Checkpoint",
      description:
        "Save a durable copy of your long-term memory, once a day. Read MEMORY.md and pass its FULL contents as memoryMarkdown. Set contextTruncated true if `openclaw doctor` reports your bootstrap context is being truncated. This is the only copy of MEMORY.md that exists off the machine — the workspace is regenerated on deploy and the memory index is rebuildable, but MEMORY.md is not. If the reply says your memory SHRANK, stop and tell the operator: something overwrote it rather than tidying it.",
      parameters: Type.Object({
        memoryMarkdown: Type.String({
          description: "The full current contents of MEMORY.md.",
        }),
        contextTruncated: Type.Optional(
          Type.Boolean({
            description:
              "True if `openclaw doctor` reports bootstrap context truncation.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("checkpoint", p, ctx.signal),
    }),

    tool({
      name: "ask_founder",
      label: "Ask Founder",
      description:
        "Ask the founder one question, delivered to them in Telegram. ONLY ONE QUESTION CAN BE OPEN AT A TIME: if one is already outstanding this returns ok:false with data.openQuestion naming it — that is correct behaviour, not a failure. Wait for the answer rather than stacking a second question; an agent that asks twice reads as someone who doesn't listen. Use this for anything needing pricing, roadmap, security, legal, or hiring facts we weren't given — never guess those.",
      parameters: Type.Object({
        question: Type.String({
          description:
            "The question, in plain language, as you'd text it. One question — not a list.",
        }),
      }),
      execute: async (p, _cfg, ctx) => call("ask_founder", p, ctx.signal),
    }),
  ],
});
