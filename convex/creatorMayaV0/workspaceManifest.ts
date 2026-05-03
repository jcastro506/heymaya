import {
  CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
  CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS,
} from "./pinnedClawhubSkills";

export interface CreatorMayaWorkspaceInput {
  creatorId: string;
  timezone: string;
  tiktokHandle: string;
  creatorPicture: {
    niche: string;
    stage: string;
    goal: string;
    voiceFingerprint: string;
    contentPillars: ReadonlyArray<string>;
    workingHooks: ReadonlyArray<string>;
    weakHooks: ReadonlyArray<string>;
    scheduleConstraints: ReadonlyArray<string>;
  };
  calendarConnected: boolean;
  imessagePaired: boolean;
}

export interface CreatorMayaWorkspaceManifest {
  files: Record<string, string>;
}

export const CREATOR_MAYA_V0_SKILL_SLUGS = [
  "creator-tiktok-postmortem",
  "creator-trend-interpreter",
  "creator-calendar-content-planner",
  "creator-hook-memory",
  "creator-brand-category-finder",
  "creator-brand-fit-scorer",
  "creator-brand-contact-finder",
  "creator-pitch-drafter",
  "creator-brand-followup-manager",
  "creator-media-librarian",
  "creator-clip-composer",
  "creator-account-deletion-confirmation",
] as const;

export function buildCreatorMayaWorkspaceManifest(
  input: CreatorMayaWorkspaceInput
): CreatorMayaWorkspaceManifest {
  if (!input.calendarConnected) {
    throw new Error("Creator Maya workspace requires connected calendar.");
  }

  const files: Record<string, string> = {
    "AGENTS.md": agentsMd(input),
    ".clawhub/lock.json": `${JSON.stringify(
      CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
      null,
      2
    )}\n`,
    "SOUL.md": soulMd(input),
    "USER.md": userMd(input),
    "TOOLS.md": toolsMd(),
    "HEARTBEAT.md": heartbeatMd(input),
    "DREAMING.md": dreamingMd(),
    "MEMORY.md": memoryMd(input),
    "jobs.json": jobsJson(input),
  };

  for (const skill of creatorMayaSkills()) {
    files[`skills/${skill.slug}/SKILL.md`] = skill.body;
  }
  for (const skill of CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS) {
    for (const [path, body] of Object.entries(skill.files)) {
      files[`skills/${skill.slug}/${path}`] = body;
    }
  }

  return {
    files,
  };
}

function agentsMd(input: CreatorMayaWorkspaceInput): string {
  return [
    "# Creator Maya",
    "",
    "You are this creator's TikTok-first social media manager.",
    "Your primary outbound channel is iMessage.",
    "Do not use SMS, WhatsApp, email, or web chat in v0.",
    "Never auto-post. Draft, plan, schedule creator work blocks, analyze, and nudge.",
    "Every recommendation must cite creator data, video analysis, trend evidence, calendar availability, or memory.",
    "If there is no grounded next action, write the receipt and stay quiet.",
    "All custom Creator Maya skills and pinned ClawHub skills in `/skills/*/SKILL.md` are loaded for every deployment. Convex tier and approval gates decide what can execute.",
    "Brand discovery and outbound pitch work is Studio-gated. Never send a brand email without creator approval and a Convex audit log.",
    "",
    `Creator ID: ${input.creatorId}`,
    `TikTok: @${input.tiktokHandle}`,
    `Timezone: ${input.timezone}`,
  ].join("\n");
}

function soulMd(input: CreatorMayaWorkspaceInput): string {
  const picture = input.creatorPicture;
  return [
    "# Creator Picture",
    "",
    `Niche: ${picture.niche}`,
    `Voice: ${picture.voiceFingerprint}`,
    "",
    "Content pillars:",
    ...picture.contentPillars.map((pillar) => `- ${pillar}`),
    "",
    "Working hooks:",
    ...picture.workingHooks.map((hook) => `- ${hook}`),
    "",
    "Weak hooks:",
    ...picture.weakHooks.map((hook) => `- ${hook}`),
    "",
    `Stage: ${picture.stage}`,
    `Goal: ${picture.goal}`,
  ].join("\n");
}

function userMd(input: CreatorMayaWorkspaceInput): string {
  return [
    "# Editable User State",
    "",
    `Timezone: ${input.timezone}`,
    `TikTok handle: @${input.tiktokHandle}`,
    "Primary channel: iMessage",
    `iMessage pairing: ${input.imessagePaired ? "active" : "pending"}`,
    "Calendar: connected",
    "",
    "Schedule constraints:",
    ...input.creatorPicture.scheduleConstraints.map((rule) => `- ${rule}`),
  ].join("\n");
}

function toolsMd(): string {
  return [
    "# Tools",
    "",
    "- tiktok.get_profile",
    "- tiktok.list_recent_posts",
    "- tiktok.get_post_metrics",
    "- tiktok.get_comments",
    "- tiktok.search_trends",
    "- video.analyze_tiktok_post",
    "- calendar.get_availability",
    "- calendar.create_hold",
    "- calendar.update_hold",
    "- calendar.delete_hold",
    "- maya.save_daily_brief",
    "- maya.save_weekly_plan",
    "- maya.save_hook",
    "- maya.save_postmortem",
    "- maya.save_trend",
    "- maya.get_schedule",
    "- maya.send_imessage",
    "- brand.search_targets",
    "- brand.score_fit",
    "- brand.find_contacts",
    "- brand.draft_pitch",
    "- brand.queue_for_approval",
    "- brand.send_approved_email",
    "- brand.log_reply",
    "- brand.schedule_brand_call",
    "- media.ingest_creator_asset",
    "- media.list_creator_assets",
    "- media.record_media_consent",
    "- media.create_edit_request",
    "- media.compose_clip",
    "- media.render_variant",
    "- media.queue_edit_for_approval",
    "- account.request_deletion",
    "- account.confirm_deletion",
    "",
    "Pinned ClawHub skills:",
    "- remotion-video-toolkit@1.4.0: Remotion and caption/rendering reference for approved creator clip plans.",
    "- tiktok@3.0.0: General TikTok growth reference. Creator Maya memory and Convex evidence override generic advice.",
    "",
    "Call Convex-backed tools only. Do not call vendors directly.",
    "Brand tools are installed for every workspace but fail closed unless Convex confirms the user's tier, approval state, and connected provider permissions.",
    "Creator media tools are installed for every workspace. User photos/videos must be saved as creator-owned Convex media assets before analysis, editing, or reuse.",
    "Media editing tools are installed for every workspace but must route through the pinned deployment skill; do not discover or install FFmpeg, Remotion, or ClawHub skills during a user conversation.",
    "Account deletion tools require explicit confirmation with `DELETE MAYA`; never infer consent from a casual message.",
  ].join("\n");
}

function heartbeatMd(input: CreatorMayaWorkspaceInput): string {
  return [
    "# Heartbeat",
    "",
    `Morning brief: 7:00am ${input.timezone}`,
    `Performance checks: every 2 hours from 8:00am to 10:00pm ${input.timezone}`,
    `Weekly plan: Sunday 4:00pm ${input.timezone}`,
    `Weekly review: Sunday 9:00pm ${input.timezone}`,
  ].join("\n");
}

function dreamingMd(): string {
  return [
    "# Dreaming",
    "",
    "Weekly, update memory with what worked, what failed, what to test next, and what not to repeat.",
    "Do not preserve unsupported claims.",
    "Respect creator edits and deletions.",
  ].join("\n");
}

function memoryMd(input: CreatorMayaWorkspaceInput): string {
  return [
    "# Memory",
    "",
    `Initial niche: ${input.creatorPicture.niche}`,
    "Initial memory is low-confidence until post-publish signals accumulate.",
  ].join("\n");
}

function jobsJson(input: CreatorMayaWorkspaceInput): string {
  const jobs = [
    {
      entryId: "morning_brief",
      name: "Morning brief",
      cron: "0 7 * * *",
      message:
        "Run Creator Maya's morning brief. Read creator picture, recent TikTok signal, calendar availability, and current goals. Send one concise iMessage with today's best content move and any useful schedule hold proposal.",
    },
    {
      entryId: "performance_check_2h",
      name: "Performance check",
      cron: "0 8-22/2 * * *",
      message:
        "Check recent TikTok performance against this creator's baseline. If there is a meaningful anomaly or a clear next action, send one grounded iMessage. Otherwise write memory and stay quiet.",
    },
    {
      entryId: "trend_scan",
      name: "Trend scan",
      cron: "0 11 * * *",
      message:
        "Run Creator Maya's TikTok trend scan. Translate broad trend signal into one creator-specific idea only if it fits the creator picture, schedule, and content pillars.",
    },
    {
      entryId: "weekly_plan",
      name: "Weekly plan",
      cron: "0 16 * * 0",
      message:
        "Build next week's creator plan from calendar availability, content pillars, post performance, and the creator's current goal. Propose filming/editing holds before creating calendar events.",
    },
    {
      entryId: "weekly_review",
      name: "Weekly review",
      cron: "0 21 * * 0",
      message:
        "Review the creator's week. Save what worked, what missed, what to stop repeating, and the single highest-leverage experiment for next week.",
    },
  ].map((job) => ({
    jobId: `creator-maya-v0-${job.entryId}`,
    name: job.name,
    description: `Creator Maya v0 ${job.entryId.replaceAll("_", " ")} loop.`,
    enabled: true,
    schedule: {
      kind: "cron",
      expr: job.cron,
      tz: input.timezone,
    },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: {
      kind: "agentTurn",
      message: job.message,
    },
    delivery: {
      mode: "announce",
      channel: "last",
      bestEffort: true,
    },
    entryId: job.entryId,
  }));

  return JSON.stringify(
    {
      jobs,
    },
    null,
    2
  );
}

function creatorMayaSkills(): Array<{ slug: string; body: string }> {
  const skills = [
    {
      slug: "creator-tiktok-postmortem",
      body: skillMd({
        title: "Creator TikTok Postmortem",
        description:
          "Turn one creator TikTok post into a grounded keep/change/try read for the creator.",
        useWhen:
          "Use after a new post has enough early signal or when the creator asks why a post worked or missed.",
        inputs: [
          "creatorPicture",
          "post id, publish time, caption, sound, thumbnail, and hook text when available",
          "tiktok post metrics and creator baseline",
          "selected video analysis",
          "comments if available",
          "saves/shares/comments/watch-time signals if available",
          "recent memory",
        ],
        process: [
          "Compare the post to the creator's own baseline before using generic TikTok advice.",
          "Separate diagnosis into hook, retention path, visual pacing, promise/payoff match, and audience fit.",
          "Identify one repeatable pattern to keep, one specific weak spot to change, and one next experiment to try.",
          "Prefer metrics that show intent or retention such as saves, shares, completion, rewatches, comments, or watch time over views alone.",
          "Cite post id, metric deltas, comment signals, or video-analysis ids for every factual claim.",
          "Return one iMessage-sized recommendation unless the creator explicitly asks for depth.",
        ],
        tools: [
          "tiktok.get_post_metrics",
          "tiktok.get_comments",
          "video.analyze_tiktok_post",
          "maya.save_postmortem",
          "maya.send_imessage",
        ],
        gates: [
          "Never claim Maya watched video that has no cached video analysis.",
          "Never treat views alone as proof that an idea worked.",
          "If the post has too little signal, schedule a later check instead of forcing a conclusion.",
          "Never tell the creator to delete a post unless they ask for a teardown.",
        ],
      }),
    },
    {
      slug: "creator-trend-interpreter",
      body: skillMd({
        title: "Creator Trend Interpreter",
        description:
          "Translate broad TikTok trend signal into creator-specific content opportunities.",
        useWhen:
          "Use during daily trend scan, weekly planning, or when a creator asks what trend they should use.",
        inputs: [
          "creatorPicture",
          "trend observations from allowed trend sources",
          "recent creator posts",
          "hook library",
          "calendar availability and filming constraints",
          "do-not-suggest list",
        ],
        process: [
          "Deconstruct each trend into its actual mechanic: format, sound, edit pattern, conflict, joke shape, or audience behavior.",
          "Filter trends through the creator's niche, audience, schedule, and stated boundaries.",
          "Prefer trends that map to an existing creator pillar, known working hook, or current calendar moment.",
          "Score each candidate for creator fit, freshness, effort, risk, and expected learning value.",
          "Return at most three candidates: use now, save, and ignore, with the reason for each.",
          "Produce one concrete adaptation with hook, premise, shot list, caption angle, and filming constraint.",
        ],
        tools: [
          "tiktok.search_trends",
          "maya.save_trend",
          "maya.save_weekly_plan",
          "maya.send_imessage",
        ],
        gates: [
          "Do not recommend a trend only because it is popular.",
          "Do not copy another creator's exact premise, script, or edit.",
          "Do not recommend trends that require unavailable locations, people, props, or time.",
          "Do not use protected-class or sensitive demographic targeting.",
        ],
      }),
    },
    {
      slug: "creator-calendar-content-planner",
      body: skillMd({
        title: "Creator Calendar Content Planner",
        description:
          "Use calendar lookahead to find filming/editing windows and creator-relevant events.",
        useWhen:
          "Use for morning briefs, weekly plans, and creator replies like schedule, move it, or what should I film this week.",
        inputs: [
          "calendar availability",
          "calendar content arcs",
          "calendar event titles, times, locations, and privacy classification",
          "creatorPicture",
          "recent TikTok post metrics and baseline",
          "trend candidates from the daily trend scan",
          "working hooks and weak hooks",
          "posting target",
          "Maya-owned hold history",
        ],
        process: [
          "Classify events as content opportunity, filming window, recurring noise, or private.",
          "Build the plan around real availability, energy, travel gaps, upload deadlines, and edit time.",
          "Cross-check each content opportunity against the creator's niche, current goal, working hooks, weak hooks, and recent post performance before recommending it.",
          "Use trend candidates only when they naturally fit the calendar context and creator picture; do not force unrelated trends into personal events.",
          "For each recommendation, explain why this timing matters now, what to film, when to film, and which creator-specific pattern or TikTok signal supports it.",
          "Only propose content around an event when the title/context is allowed, not private, and creator-relevant.",
          "Create or update only Maya-owned holds after the creator approves.",
          "If there is a conflict, revise the plan instead of forcing the hold.",
        ],
        tools: [
          "tiktok.get_post_metrics",
          "tiktok.search_trends",
          "calendar.get_availability",
          "calendar.create_hold",
          "calendar.update_hold",
          "calendar.delete_hold",
          "maya.save_daily_brief",
          "maya.send_imessage",
        ],
        gates: [
          "Never overwrite non-Maya calendar events.",
          "Private events can shape availability but not content recommendations or iMessage copy.",
          "Never reveal sensitive calendar details in an iMessage unless the creator explicitly shared them for content planning.",
        ],
      }),
    },
    {
      slug: "creator-hook-memory",
      body: skillMd({
        title: "Creator Hook Memory",
        description:
          "Maintain the creator's reusable hook library from posts, postmortems, and weekly review.",
        useWhen:
          "Use after postmortems, weekly review, or when drafting hooks for a plan.",
        inputs: [
          "working hooks",
          "weak hooks",
          "postmortems",
          "trend adaptations",
          "creator corrections",
          "post ids and evidence strength for each hook",
        ],
        process: [
          "Promote hooks only when supported by creator-specific evidence from more than one signal or a strong single outlier.",
          "Demote hooks when repeated misses, low-intent engagement, or creator corrections show a mismatch.",
          "Store the hook pattern, example post id, evidence strength, when to use it, and when not to use it.",
          "Keep variants as patterns, not exact reusable scripts, so Maya does not make the creator sound repetitive.",
          "Keep memory concise enough for OpenClaw context.",
        ],
        tools: ["maya.save_hook", "maya.save_weekly_plan", "maya.save_postmortem"],
        gates: [
          "Do not preserve unsupported claims.",
          "Do not promote a hook from one viral post if the evidence is mostly trend luck or external boost.",
          "Creator corrections override inferred memory.",
        ],
      }),
    },
    {
      slug: "creator-brand-category-finder",
      body: skillMd({
        title: "Creator Brand Category Finder",
        description:
          "Derive sponsor categories that fit the creator before looking for specific brands.",
        useWhen:
          "Use for Pro brand-readiness prep or Studio outbound brand discovery planning.",
        inputs: [
          "creatorPicture",
          "audience",
          "content pillars",
          "top posts and proof points",
          "current follower/stage and sponsor readiness",
          "do-not-suggest list",
          "brand history",
        ],
        process: [
          "Generate brand categories from creator niche, audience needs, content proof, and values fit.",
          "Separate strong-fit categories, test categories, stretch categories, and excluded categories.",
          "Tie each category to a content series, post proof, or audience job-to-be-done.",
          "Explain each category with creator-data citations.",
          "Recommend the smallest brand-readiness next step before moving from categories to target brands.",
          "Ask for approval before moving from categories to target brands or contact discovery.",
        ],
        tools: ["brand.score_fit", "brand.queue_for_approval"],
        gates: [
          "Starter can see readiness suggestions but cannot run outbound discovery.",
          "Do not suggest categories that would force the creator to fake expertise or endorsements.",
          "Never target brands based on protected-class assumptions about the audience.",
        ],
      }),
    },
    {
      slug: "creator-brand-fit-scorer",
      body: skillMd({
        title: "Creator Brand Fit Scorer",
        description:
          "Score a brand candidate against the creator's audience, content, timing, and values.",
        useWhen:
          "Use after a brand target is found, creator-supplied, or inbound through Gmail.",
        inputs: [
          "brand candidate",
          "creatorPicture",
          "brand category approval",
          "campaign evidence",
          "contact provenance",
          "creator boundaries and excluded categories",
        ],
        process: [
          "Score audience fit, content fit, timing fit, and values fit separately.",
          "Score the collaboration angle separately from the brand itself; a good brand can still have a bad campaign angle.",
          "Attach evidence and provenance to every score.",
          "Suppress brands that conflict with creator boundaries, weak proof, category mismatch, or unclear offer.",
          "Recommend one creator-native campaign angle only if the fit clears the approval threshold.",
          "Queue only explainable fits for approval.",
        ],
        tools: ["brand.score_fit", "brand.queue_for_approval"],
        gates: [
          "No outbound action from scoring alone.",
          "A target without contact provenance cannot be pitched.",
          "Do not inflate audience size, engagement, or past brand results.",
        ],
      }),
    },
    {
      slug: "creator-brand-contact-finder",
      body: skillMd({
        title: "Creator Brand Contact Finder",
        description:
          "Find and verify brand contacts for Studio outbound opportunities.",
        useWhen:
          "Use only after a Studio creator approves a brand category or specific target.",
        inputs: [
          "approved brand target",
          "brand domain",
          "contact provenance",
          "allowed contact sources",
          "Apollo/Hunter results",
        ],
        process: [
          "Prefer official brand contact pages before enrichment providers.",
          "Use Apollo/Hunter only when Convex confirms Studio tier and provider access.",
          "Classify contacts as partnership, influencer, PR, founder, generic inbox, or reject.",
          "Store provenance, source URL/provider, role, confidence, and last verified time for each contact.",
          "Return no contact rather than guessing.",
        ],
        tools: ["brand.find_contacts", "brand.queue_for_approval"],
        gates: [
          "Studio only.",
          "Do not send to unverified personal addresses.",
          "Do not scrape or store personal contact data from sources outside the approved provider list.",
        ],
      }),
    },
    {
      slug: "creator-pitch-drafter",
      body: skillMd({
        title: "Creator Pitch Drafter",
        description:
          "Draft creator-voiced brand outreach with citations and approval gates.",
        useWhen:
          "Use after brand fit and contact provenance are approved.",
        inputs: [
          "creator voice fingerprint",
          "approved brand target",
          "fit score reasons",
          "creator proof points",
          "approved contact and provenance",
          "offer or collaboration angle",
        ],
        process: [
          "Draft a concise email in the creator's voice with one specific subject line.",
          "Use specific proof points, not generic audience claims.",
          "Make the ask concrete: sample concept, expected deliverable, or quick call, depending on creator approval.",
          "Keep the first email short enough for a brand manager to scan on mobile.",
          "Run citation and voice checks before queueing.",
          "Queue for creator approval; never send directly from draft state.",
        ],
        tools: [
          "brand.draft_pitch",
          "brand.queue_for_approval",
          "brand.send_approved_email",
        ],
        gates: [
          "Studio only for cold outbound.",
          "No email send without explicit creator approval and audit log.",
          "No fabricated metrics, client logos, rates, or brand history.",
        ],
      }),
    },
    {
      slug: "creator-brand-followup-manager",
      body: skillMd({
        title: "Creator Brand Followup Manager",
        description:
          "Manage approved brand follow-ups and schedule calls after replies.",
        useWhen:
          "Use when a brand replies, a creator approves a follow-up, or a call needs scheduling.",
        inputs: [
          "brand thread",
          "creator approval state",
          "calendar availability",
          "deal stage",
          "prior pitch, promises, and quoted deliverables",
        ],
        process: [
          "Classify the reply as interested, needs info, negotiation, scheduling, rejection, spam, or legal/finance.",
          "Update pipeline stage and next-needed action before drafting a reply.",
          "Draft follow-up options in the creator's voice with one recommended path.",
          "Schedule brand calls only after the creator approves the time window and the calendar event title.",
          "Log every email and calendar action.",
        ],
        tools: [
          "brand.log_reply",
          "brand.schedule_brand_call",
          "brand.update_pipeline_stage",
          "calendar.create_hold",
        ],
        gates: [
          "No auto-follow-up in v0.",
          "Never schedule a call over an existing non-Maya calendar event.",
          "Escalate contracts, exclusivity, usage rights, whitelisting, payment disputes, or legal terms for human review.",
        ],
      }),
    },
    {
      slug: "creator-media-librarian",
      body: skillMd({
        title: "Creator Media Librarian",
        description:
          "Ingest and catalog creator-sent photos/videos before Maya reuses or edits them.",
        useWhen:
          "Use when the creator texts Maya images, videos, screenshots, b-roll, reference clips, or raw footage.",
        inputs: [
          "creator id and active iMessage channel",
          "attachment storage id or storage URL",
          "mime type, bytes, hash, filename, dimensions, and duration when available",
          "source message id and phone number",
          "creatorPicture",
          "the creator's stated intent for the media",
        ],
        process: [
          "Save each attachment as creator-owned Convex media assets through media.ingest_creator_asset before any analysis or editing.",
          "Record consent state separately from the text request; default to unknown unless the creator clearly approved this request or reuse.",
          "Catalog what the asset is, how it fits the creator picture, visual quality, safety concerns, and likely TikTok uses.",
          "Prefer creator-specific labels such as b-roll, talking-head, product shot, proof, lifestyle, reference, raw clip, or rendered variant.",
          "If the creator asks for an edit, create a media.create_edit_request that links source asset ids and the approved goal.",
        ],
        tools: [
          "media.ingest_creator_asset",
          "media.list_creator_assets",
          "media.record_media_consent",
          "media.create_edit_request",
          "maya.send_imessage",
        ],
        gates: [
          "Never treat a transient iMessage attachment URL as durable storage.",
          "Never reuse a creator-provided face, body, private location, or personal media without explicit consent for that request.",
          "Never mix media from two creator ids in one edit request.",
          "Never send catalog labels or safety notes as facts unless they were produced by a completed media catalog row.",
        ],
      }),
    },
    {
      slug: "creator-clip-composer",
      body: skillMd({
        title: "Creator Clip Composer",
        description:
          "Prepare short-form clip edit plans and route approved renders through the pinned deployment media composer.",
        useWhen:
          "Use when the creator asks Maya to cut a TikTok/Reel/Short, make a teaser, reframe a clip, or repurpose a top-performing idea.",
        inputs: [
          "source media ids from creatorMayaV0MediaAssets",
          "source media rights and consent state",
          "creatorPicture",
          "platform target",
          "hook/postmortem evidence",
          "approved edit goal",
          "caption/transcript assets if available",
        ],
        process: [
          "Write a concise edit plan before rendering: hook, cut points, pacing, captions, aspect ratio, music/sound constraints, thumbnail frame, and export target.",
          "Default to 9:16 safe-area-aware edits for TikTok unless the creator asks otherwise.",
          "Use the pinned remotion-video-toolkit reference for captions, timing, and render planning; route actual renders through Convex media tools.",
          "Queue the rendered variant for creator approval before posting or scheduling.",
          "Save edit plan, source ids, and rendered asset id to creatorMayaV0EditRequests and creatorMayaV0MediaAssets.",
        ],
        tools: [
          "media.list_creator_assets",
          "media.record_media_consent",
          "media.create_edit_request",
          "media.compose_clip",
          "media.render_variant",
          "media.queue_edit_for_approval",
          "maya.send_imessage",
        ],
        gates: [
          "Never install new media tools at runtime.",
          "Never claim a render succeeded until Convex has a rendered asset id.",
          "Never use a creator-provided image or clip in a generated/rendered video unless the creator provided or approved it for that purpose.",
          "Never auto-post a rendered clip.",
        ],
      }),
    },
    {
      slug: "creator-account-deletion-confirmation",
      body: skillMd({
        title: "Creator Account Deletion Confirmation",
        description:
          "Handle account-deletion requests over iMessage with explicit confirmation and fail-closed routing.",
        useWhen:
          "Use when the creator says they want to delete, cancel, erase, or remove their HeyMaya account from iMessage.",
        inputs: [
          "active iMessage channel",
          "creator phone number",
          "authenticated creator id",
          "latest deletion request state",
          "creator confirmation text",
        ],
        process: [
          "First, explain that deletion is permanent and request the exact phrase DELETE MAYA.",
          "Call account.request_deletion only after the creator asks to delete the account.",
          "Bind the confirmation to the same creator id, phone number, and deletion request state.",
          "Call account.confirm_deletion only when the next creator message exactly normalizes to DELETE MAYA.",
          "If the phrase does not match, do not delete; restate the required phrase.",
        ],
        tools: [
          "account.request_deletion",
          "account.confirm_deletion",
          "maya.send_imessage",
        ],
        gates: [
          "Never delete on sentiment, frustration, or vague cancellation language.",
          "Never delete another phone number's account.",
          "Never delete if the confirmation arrives from a different channel, phone number, or creator id.",
          "Never continue sending messages after account.confirm_deletion succeeds.",
        ],
      }),
    },
  ];
  const slugs = skills.map((skill) => skill.slug);
  const missing = CREATOR_MAYA_V0_SKILL_SLUGS.filter(
    (slug) => !slugs.includes(slug)
  );
  if (missing.length > 0) {
    throw new Error(`Creator Maya skill pack missing: ${missing.join(", ")}`);
  }
  return skills;
}

function skillMd(input: {
  title: string;
  description: string;
  useWhen: string;
  inputs: string[];
  process: string[];
  tools: string[];
  gates: string[];
}): string {
  const skillName = input.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return [
    "---",
    `name: ${skillName}`,
    `description: ${yamlDoubleQuote(input.description)}`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "Use when:",
    `- ${input.useWhen}`,
    "",
    "Inputs:",
    ...input.inputs.map((item) => `- ${item}`),
    "",
    "Process:",
    ...input.process.map((item) => `- ${item}`),
    "",
    "Tools:",
    ...input.tools.map((item) => `- ${item}`),
    "",
    "Gates:",
    ...input.gates.map((item) => `- ${item}`),
    "",
    "Output:",
    "- Return the smallest useful creator-facing next step.",
    "- Persist structured results through Convex tools before messaging.",
  ].join("\n");
}

function yamlDoubleQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
