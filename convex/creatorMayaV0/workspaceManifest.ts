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
    "All custom Creator Maya skills in `/skills/*/SKILL.md` are loaded for every deployment. Convex tier and approval gates decide what can execute.",
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
    "- media.compose_clip",
    "- media.render_variant",
    "- media.queue_edit_for_approval",
    "- account.request_deletion",
    "- account.confirm_deletion",
    "",
    "Call Convex-backed tools only. Do not call vendors directly.",
    "Brand tools are installed for every workspace but fail closed unless Convex confirms the user's tier, approval state, and connected provider permissions.",
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
          "tiktok post metrics and baseline",
          "selected video analysis",
          "comments if available",
          "recent memory",
        ],
        process: [
          "Compare the post to the creator's own baseline before using generic TikTok advice.",
          "Identify one repeatable hook, one weak spot, and one next experiment.",
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
          "trend observations",
          "recent creator posts",
          "hook library",
          "do-not-suggest list",
        ],
        process: [
          "Filter trends through the creator's niche, audience, schedule, and stated boundaries.",
          "Prefer trends that map to an existing creator pillar or known working hook.",
          "Score each candidate as use now, save, or ignore.",
          "Produce one concrete adaptation with caption/hook angle and filming constraint.",
        ],
        tools: [
          "tiktok.search_trends",
          "maya.save_trend",
          "maya.save_weekly_plan",
          "maya.send_imessage",
        ],
        gates: [
          "Do not recommend a trend only because it is popular.",
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
          "creatorPicture",
          "posting target",
          "Maya-owned hold history",
        ],
        process: [
          "Classify events as content opportunity, filming window, recurring noise, or private.",
          "Only propose content around an event when the title/context is allowed and creator-relevant.",
          "Create or update only Maya-owned holds after the creator approves.",
          "If there is a conflict, revise the plan instead of forcing the hold.",
        ],
        tools: [
          "calendar.get_availability",
          "calendar.create_hold",
          "calendar.update_hold",
          "calendar.delete_hold",
          "maya.save_daily_brief",
          "maya.send_imessage",
        ],
        gates: [
          "Never overwrite non-Maya calendar events.",
          "Private events can shape availability but not content recommendations.",
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
        ],
        process: [
          "Promote hooks only when supported by creator-specific evidence.",
          "Demote hooks when repeated misses or creator corrections show a mismatch.",
          "Store the hook pattern, example post id, and when to use it.",
          "Keep memory concise enough for OpenClaw context.",
        ],
        tools: ["maya.save_hook", "maya.save_weekly_plan", "maya.save_postmortem"],
        gates: [
          "Do not preserve unsupported claims.",
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
          "do-not-suggest list",
          "brand history",
        ],
        process: [
          "Generate brand categories from creator niche, audience needs, content proof, and values fit.",
          "Separate strong-fit categories from stretch categories and excluded categories.",
          "Explain each category with creator-data citations.",
          "Ask for approval before moving from categories to target brands.",
        ],
        tools: ["brand.score_fit", "brand.queue_for_approval"],
        gates: [
          "Starter can see readiness suggestions but cannot run outbound discovery.",
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
        ],
        process: [
          "Score audience fit, content fit, timing fit, and values fit separately.",
          "Attach evidence and provenance to every score.",
          "Suppress brands that conflict with creator boundaries or weak fit.",
          "Queue only explainable fits for approval.",
        ],
        tools: ["brand.score_fit", "brand.queue_for_approval"],
        gates: [
          "No outbound action from scoring alone.",
          "A target without contact provenance cannot be pitched.",
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
          "Apollo/Hunter results",
        ],
        process: [
          "Prefer official brand contact pages before enrichment providers.",
          "Use Apollo/Hunter only when Convex confirms Studio tier and provider access.",
          "Store provenance and confidence for each contact.",
          "Return no contact rather than guessing.",
        ],
        tools: ["brand.find_contacts", "brand.queue_for_approval"],
        gates: [
          "Studio only.",
          "Do not send to unverified personal addresses.",
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
          "offer or collaboration angle",
        ],
        process: [
          "Draft a concise email in the creator's voice.",
          "Use specific proof points, not generic audience claims.",
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
        ],
        process: [
          "Classify the reply and update pipeline stage.",
          "Draft follow-up options in the creator's voice.",
          "Schedule brand calls only after the creator approves the time window.",
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
          "source media ids",
          "creatorPicture",
          "platform target",
          "hook/postmortem evidence",
          "approved edit goal",
        ],
        process: [
          "Write a concise edit plan before rendering: hook, cut points, captions, aspect ratio, music/sound constraints, and export target.",
          "Prefer the pinned ClawHub/cloud composer when available; fallback to the pinned Remotion/FFmpeg adapter only if the deploy manifest says it is installed.",
          "Queue the rendered variant for creator approval before posting or scheduling.",
          "Save edit plan, source ids, and rendered asset id to Convex.",
        ],
        tools: [
          "media.compose_clip",
          "media.render_variant",
          "media.queue_edit_for_approval",
          "maya.send_imessage",
        ],
        gates: [
          "Never install new media tools at runtime.",
          "Never claim a render succeeded until Convex has a rendered asset id.",
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
          "latest deletion request state",
          "creator confirmation text",
        ],
        process: [
          "First, explain that deletion is permanent and request the exact phrase DELETE MAYA.",
          "Call account.request_deletion only after the creator asks to delete the account.",
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
  return [
    `# ${input.title}`,
    "",
    `Description: ${input.description}`,
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
