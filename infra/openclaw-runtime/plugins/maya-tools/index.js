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
      name: "make_video",
      label: "Make video",
      description:
        "Propose a vertical video for a banked idea and STOP at the storyboard. Nothing is rendered and nothing is spent by this call. You get back data.storyboard — the exact frames, each with the line that plays over it. SEND IT VERBATIM AND WAIT. The founder is being asked to check the actual shots, so summarising it defeats the point: a wrong screenshot caught here costs nothing and caught after the render costs the render. Needs an ideaId, because every post traces back to something a real person said. If there aren't enough real shots of the product you get ok:false saying so — that is a real answer, and the fix is to ask them for a screen recording, never to invent a shot of a product you have not seen.",
      parameters: Type.Object({
        ideaId: Type.String({
          description:
            "The idea this video is built from. From scroll's data.todaysIdea.ideaId, or the bank.",
        }),
        rung: Type.Optional(
          Type.String({
            description:
              "avatar (our script, their assembly) or ad_clone (recreate a proven shape with this product — far more expensive, worth it about once a month). Leave it out for avatar.",
          })
        ),
        referenceVideoUrl: Type.Optional(
          Type.String({
            description:
              "Only for ad_clone: the proven video whose STRUCTURE is being recreated. Never its claims — a clone that repeats someone else's numbers is a defect.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("make_video", p, ctx.signal),
    }),

    tool({
      name: "approve_video",
      label: "Approve video",
      description:
        "The founder said go, so start the render. THIS IS THE ONLY CALL THAT SPENDS A CREDIT. Call it only after they have actually seen the storyboard and said yes — not because it seems fine to you, and not to save them a step. Takes the jobId from make_video.",
      parameters: Type.Object({
        jobId: Type.String({
          description: "From make_video's data.jobId.",
        }),
      }),
      execute: async (p, _cfg, ctx) => call("approve_video", p, ctx.signal),
    }),

    tool({
      name: "adapt_crosspost",
      label: "Adapt crosspost",
      description:
        "Rewrite one drafted post for other channels. NEVER POST THE SAME CAPTION TO TWO CHANNELS — identical captions across TikTok and Reels are one of the most recognisable signs of an automated account, and this tool refuses rather than shipping one. Takes a draftId; the words come from the draft so the variants adapt what the founder will actually see. Hashtags are chosen only from sets mined from the niche — if a channel has none, you get an empty list, and that is correct rather than a gap to fill. YouTube also gets a title, which is a promise about the next thirty seconds, not a caption. Each variant still has to be saved as its OWN draft before it can be published.",
      parameters: Type.Object({
        draftId: Type.String({
          description: "The post to adapt. From draft's data.draftId.",
        }),
        channels: Type.Array(Type.String(), {
          description:
            "Which channels to adapt for — only ones the founder has actually connected.",
        }),
        assetSummary: Type.Optional(
          Type.String({
            description:
              "What the image or video shows, in a few words, so a caption doesn't just describe it back.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("adapt_crosspost", p, ctx.signal),
    }),

    tool({
      name: "confirm_preview",
      label: "Confirm preview",
      description:
        "Record that the founder okayed EXACTLY this post and these images. REQUIRED BEFORE ANY TIKTOK POST — TikTok requires a human to see what will be published, publish holds without it, and that is TikTok's rule rather than ours. Call this only after they actually said yes to what you showed them. Pass the assetIds in the order you showed them; a carousel's order is part of what they approved. ⚠️ The approval covers that exact wording and those exact images: change a character of the caption or swap a slide afterwards and it no longer applies, and you will have to ask again.",
      parameters: Type.Object({
        draftId: Type.String({
          description: "The draft they approved. `pending` lists drafts waiting on an answer.",
        }),
        assetIds: Type.Array(Type.String(), {
          description:
            "The slide assetIds you showed them, in the order you showed them. From make_carousel's data.slides[].assetId.",
        }),
      }),
      execute: async (p, _cfg, ctx) => call("confirm_preview", p, ctx.signal),
    }),

    tool({
      name: "forget_asset",
      label: "Forget asset",
      description:
        "Remove an image or video from the media library for good. Use it when the founder says a screenshot is wrong, out of date, or shows something they'd rather not show — a stale screenshot is worse than none, because real screenshots outrank generated ones and this one would get picked. IRREVERSIBLE: anything they sent can only come back if they send it again, so ask before removing something you are not sure about.",
      parameters: Type.Object({
        assetId: Type.String({
          description: "The asset to remove. From request_assets, or make_carousel's slides.",
        }),
      }),
      execute: async (p, _cfg, ctx) => call("forget_asset", p, ctx.signal),
    }),

    tool({
      name: "make_carousel",
      label: "Make carousel",
      description:
        "Turn a banked idea into a finished set of slide images, stored and ready to post. THIS IS THE CHEAP DAILY FORMAT — title, point and CTA slides are the founder's words in their own typeface and colours, so a photo post costs almost nothing to make. Needs an ideaId; there is no free-text path, because a picture has to trace to real evidence for the same reason a caption does. Returns data.slides[] with a public url per slide, in order. ok:false is an ANSWER, and `next` tells you what to actually do: a rejected set or a broken house rule must NOT be retried on the same angle — take a different angle or a different idea. For TikTok the founder must see these and okay them before publishing; that is TikTok's requirement, not ours, and publish will hold without it.",
      parameters: Type.Object({
        ideaId: Type.String({
          description:
            "The idea this set is built from. Comes from scroll's data.todaysIdea.ideaId, or the bank.",
        }),
        steer: Type.Optional(
          Type.String({
            description:
              "Optional nudge from the founder — 'lead with the pricing bit'. Leave it out unless they said something.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("make_carousel", p, ctx.signal),
    }),

    tool({
      name: "draft",
      label: "Draft",
      description:
        "Write a post down. THE ONLY WAY TEXT BECOMES POSTABLE. A POST NEEDS AN ideaId — publish takes a draftId, so a sentence that was never drafted cannot be posted no matter how good it is. Returns {ok, data, next, why}; data.draftId is what publish needs. ok:false is an ANSWER you can act on immediately, not an error: data.problem names what's wrong (over_length · empty · channel_missing · token_expired · duplicate) and `why` says it in the founder's language. Fix it and save again. Save the text EXACTLY as it should appear — this is what the founder sees and what gets published, character for character.",
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
        ideaId: Type.Optional(
          Type.String({
            description:
              "REQUIRED for a post, and ignored for a reply. Comes from scroll's data.todaysIdea.ideaId. Every post has to trace to something a real person actually said — without one you get ok:false and the idea you should have used. A reply needs no ideaId because the thing being replied to IS the evidence.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("draft", p, ctx.signal),
    }),

    tool({
      name: "pending",
      label: "Pending",
      description:
        "What you have written that the founder has NOT answered yet, with the draftId for each. ALSO HOW YOU RECORD A NO: when they turn a draft down, call this with rejectDraftId and their reason IN THEIR WORDS. A no with no reason teaches nothing and is refused. This is the second-strongest signal you ever get — an edit tells you the words were wrong, a no tells you the IDEA was, and nothing else can teach you that because a post they never let out earns no views to learn from. Do not rewrite the same idea more carefully afterwards; the idea was the problem. CALL THIS WHENEVER THEY SAY YES, GO, SEND IT, DO IT, OR ANYTHING THAT SOUNDS LIKE APPROVAL — publish needs a draftId and this is the only way to get one for a draft you offered on an earlier turn. `draft` only returns the id of what it just wrote, and `history` returns things already POSTED. Without this a post you showed them yesterday can never be published, however clearly they approve it. Also call it when they ask what you are waiting on. An empty list is a real answer — say the zero plainly rather than implying something is in flight. Expired drafts are not listed: offering a day-old post is worse than not offering it, because saying yes commits them to something written for a moment that has passed.",
      parameters: Type.Object({
        rejectDraftId: Type.Optional(
          Type.String({
            description:
              "The draft they turned down. Omit to just list what is waiting.",
          })
        ),
        reason: Type.Optional(
          Type.String({
            description:
              "Why they said no, in THEIR words — quote them, never tidy it up. Required whenever rejectDraftId is given.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("pending", p, ctx.signal),
    }),

    tool({
      name: "publish",
      label: "Publish",
      description:
        "Publish an approved draft to its channel. THE ONLY WAY TO POST. Pass draftId; set alreadyApproved when the founder has said yes to THIS draft in chat or tapped it. Returns {ok, data, next, why}. ok:false with data.holdReason is a real ANSWER, not an error — the post is held for a named reason (show_me_first · safety_floor · channel_unavailable · tiktok_preview_consent). Relay `why` to the founder in their language and DO NOT RETRY. ok:true means it is on its way, NOT that it is up. Wait until you can see the live link before you tell them it posted \u2014 and say it the way a person would: \"it's going out now, I'll send you the link when it's up.\" Never repeat the words in this description back to them.",
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
      
        editedText: Type.Optional(
          Type.String({
            description:
              "The founder's OWN rewrite, if they changed anything before saying yes. Pass it verbatim — do not tidy it. This is the strongest signal you ever get about how they write: a sample shows their register, an edit shows what you got wrong. It is stored and folded into your voice, and the edited text is what gets posted.",
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
      name: "remember",
      label: "Remember",
      description:
        "File a rule the founder just gave you, so it outlives this conversation. USE IT THE MOMENT THEY SAY ONE — 'don't post before 9', 'stop saying game-changer', 'we pivoted to agencies', 'my buyers are agencies not solo devs'. A rule you only hold in context lasts until the context rolls, and then you break it. Pass their EXACT words as `verbatim`, never your summary: the payoff is being able to quote them back months later, and a paraphrase is not proof you were listening. kind `product_truth` also updates what you're allowed to claim about the product, so use it when they correct a FACT rather than give an instruction. Returns {directiveId, productUpdated}. Say it back in your own words afterwards so they can catch you if you filed it wrong.",
      parameters: Type.Object({
        verbatim: Type.String({
          description: "Exactly what they typed. Not cleaned up, not summarized.",
        }),
        kind: Type.String({
          description:
            "posting_mode · channel_toggle · cadence · timing_window · topic · phrase_ban · voice · entity_rule · approved_claim · product_truth · icp_correction · notification_pref · pause · escalation · standing_task · campaign · other",
        }),
        meaning: Type.Optional(
          Type.String({
            description: "Your reading of what it means in practice. Optional; the verbatim is what matters.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("remember", p, ctx.signal),
    }),

    tool({
      name: "update",
      label: "Update",
      description:
        "Tell the founder something without being asked — the morning brief, the evening recap, a placement that went live, something that broke. THE ONLY WAY TO SPEAK FIRST; ask_founder is for QUESTIONS and is capped separately. Budgeted at a few a day: ok:false with data.limit means you have used them up, and that is a real answer — hold it until tomorrow, do NOT retry, and do NOT work around it by phrasing it as a question. Deduped per kind per day, so a cron that fires twice sends one brief. Say what happened, in their language, with links where there are links. A recap with no placements says so plainly rather than padding.",
      parameters: Type.Object({
        body: Type.String({
          description:
            "The message, exactly as they should read it. Plain language, no internal terms, no status-report voice.",
        }),
        kind: Type.Optional(
          Type.String({
            description:
              "brief · recap · alert · update (default). Used for the daily dedupe key, so the same kind twice in one day sends once.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("update", p, ctx.signal),
    }),

    tool({
      name: "history",
      label: "History",
      description:
        "What you have ACTUALLY posted, with URLs. CHECK THIS BEFORE ANSWERING ANY QUESTION ABOUT YOUR OWN WORK — 'what did you post', 'how did that do', 'did you publish it', 'have you done anything yet'. Placements are facts in rows, not something to recall: you once told a founder you hadn't posted anything to X when two of your posts were live and they could see both. That is worse than forgetting, because they can check. An empty result is a real answer — say the zero plainly rather than softening it. Takes an optional `days` (default 14).",
      parameters: Type.Object({
        days: Type.Optional(
          Type.Number({
            description: "How far back to look. Default 14, max 90.",
          })
        ),
      
        query: Type.Optional(
          Type.String({
            description:
              "Search everything you have EVER posted for this angle, instead of listing recent ones. Use it before drafting anything you suspect you have said before — you are told not to repeat yourself and this is the only way to check. A 14-day timeline cannot tell you whether you made this exact point in March.",
          })
        ),
        placementId: Type.Optional(
          Type.String({
            description:
              "Trace one post back to the idea and the evidence it came from. Use it when asked WHY you posted something. The answer is the chain — never reconstruct a reason, because a plausible story they cannot correct is worse than saying you cannot trace it.",
          })
        ),
}),
      execute: async (p, _cfg, ctx) => call("history", p, ctx.signal),
    }),

    tool({
      name: "inbox",
      label: "Inbox",
      description:
        "Who has replied to your posts and is still waiting on you. THIS IS HOW YOU FIND SOMEONE TO REPLY TO — `reply` refuses without an `inReplyTo`, and this is the only thing that produces one. Half the job is answering people; a post nobody follows up on is a broadcast. It syncs and returns in one call, oldest first, because whoever asked two days ago is the one about to give up. Pass BOTH `inReplyTo` and `inboxItemId` back to `reply` so the same person is never answered twice. If it says some accounts couldn't be read, say so rather than implying you have seen everything. An empty inbox is a real answer — never invent something to respond to. NOTE: TikTok exposes no comment API at all, so nothing from TikTok will ever appear here and you must not claim to be watching TikTok replies.",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) => call("inbox", p, ctx.signal),
    }),

    tool({
      name: "rules",
      label: "House rules",
      description:
        "The house rules a founder has given you, in their own words. THREE THINGS: `action:\"list\"` (default) reads them back — do this whenever they ask what rules they have, and quote their sentences with dates, because seeing their own words listed is the proof you remembered. `action:\"forget\"` with a `directiveId` retires one — it stays in the history and stops applying; never guess which one they mean, list first. `action:\"why\"` with an optional `kind` answers \"why did you do that\" FROM THE RECORD. ⚠️ If `why` comes back empty, say you have no record of being told that — do NOT reconstruct a reason. A plausible story you invented is worse than admitting you don't know, because they cannot correct it. These rules are also enforced server-side at publish, so a post that breaks one is held whether or not you remember it.",
      parameters: Type.Object({
        action: Type.Optional(
          Type.String({ description: '"list" (default), "forget", or "why".' })
        ),
        directiveId: Type.Optional(
          Type.String({ description: "Required for forget. Get it from list." })
        ),
        kind: Type.Optional(
          Type.String({ description: "Optional filter for why." })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("rules", p, ctx.signal),
    }),

    tool({
      name: "weekly_read",
      label: "Weekly read",
      description:
        "The slower questions, once a week: what SHAPES are working right now (including outside this niche, where the topic is useless but the structure travels), and what actually happened to these people this week with sources you can cite. Use the world findings for WHAT to talk about and the shapes for HOW. Cite a source when you mention what people are saying — an uncited claim is a guess wearing a finding's clothes. `unciteable` counts questions that came back without a source; if it is high, say the week was hard to read rather than reporting thin findings as solid. A quiet week is a real answer.",
      parameters: Type.Object({}),
      execute: async (p, _cfg, ctx) => call("weekly_read", p, ctx.signal),
    }),

    tool({
      name: "request_assets",
      label: "Request assets",
      description:
        "Ask the founder for ONE 30-60 second screen recording of them using the product. Only call this when you genuinely have nothing real to work with — it checks first and returns ok:false if the library is fine, which is the common case. Half of products publish no usable screenshot anywhere, and for those founders this recording is the only real product imagery that will ever exist: it gives stills, clips, and post ideas from a single file. Never ask for five screenshots instead; it's more work for them and less for you. Never ask for a login. It spends one of your few unprompted messages and is capped to once a day, so if it comes back ok:false, believe it and move on with what you have.",
      parameters: Type.Object({
        body: Type.Optional(
          Type.String({
            description:
              "Your own wording for the ask, in their language. Omit for the default. Say WHY you need it and how little work it is.",
          })
        ),
      }),
      execute: async (p, _cfg, ctx) => call("request_assets", p, ctx.signal),
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
