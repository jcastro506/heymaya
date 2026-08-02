/**
 * The `convex/maya` workspace bundle (§15.1, §18 Sprint 3).
 *
 * This is what a machine wakes up holding: the doctrine, the founder, the
 * product, the tools, and the skills. Everything the model knows that isn't a
 * row it fetched.
 *
 * ## Two rules that shape every choice here
 *
 * **1. The prompt budget is real and it is a ceiling.** ~108,900 chars, of which
 * the always-loaded set targets ~76k (§15.1.2). The frozen v1 pack sits at
 * ZERO headroom, which is why it can't take another sentence without something
 * being cut first. `buildMayaWorkspace` returns its own accounting so a test
 * fails the build rather than a deploy discovering it. Budget is measured, not
 * hoped for.
 *
 * **2. There is no `jobs.json`, deliberately.** v1 ships agent-side cron jobs.
 * That makes the machine schedule itself, which means it is awake to check
 * whether it should be awake — and a spinning heartbeat keeps a machine hot 24/7
 * by definition. Auto-stop is a 10× cost lever ($100–400/mo vs $1,400–3,000 at
 * 200 customers, §17.36.1) and a self-scheduling agent throws it away.
 *
 * > **Convex owns the clock. The machine owns judgment.**
 *
 * Convex crons decide *when*; they wake her and she decides *what*. A test
 * asserts no `jobs.json` is emitted, because this is exactly the kind of thing
 * that gets re-added by someone porting a feature across from v1.
 */

import { BUNDLED_MAYA_SKILLS, MAYA_CONVENTIONS } from "./bundledSkills";

export type MayaChannel = "tiktok" | "instagram" | "youtube" | "x";

/**
 * Where things go on the machine.
 *
 * The workspace is NOT `/workspace` — OpenClaw defaults to
 * `~/.openclaw/workspace` and we point it at the persistent volume instead, so
 * it survives a machine recreate. The gateway config lives outside the
 * workspace by design (`concepts/agent-workspace.md`: config, credentials, and
 * sessions are explicitly not workspace files).
 */
export const WORKSPACE_DIR = "/data/workspace";
export const OPENCLAW_CONFIG_PATH = "/data/openclaw.json";

export interface MayaWorkspaceInput {
  founder: {
    email: string;
    name?: string;
    timezone: string;
  };
  product: {
    name: string;
    url: string;
    /** What it actually does, in the founder's words. Grounding for every claim. */
    truth?: string;
    differentiator?: string;
  };
  /** Connected channels and their switch positions. Only these ship norms. */
  channels: Array<{
    channel: MayaChannel;
    postingMode: "show_me_first" | "just_go";
  }>;
  /** Learned from the founder's real posts and their edits to drafts. */
  voiceExcerpts?: string[];
  /** Current strategy and today's posture. */
  posture?: string;
}

export interface MayaWorkspaceBundle {
  files: Map<string, string>;
  /** Files OpenClaw holds in context on every turn. */
  alwaysLoaded: string[];
  /** Total chars of the always-loaded set — the number that must fit. */
  alwaysLoadedChars: number;
}

/**
 * Loaded on every turn. Adding a file here spends budget on all turns forever,
 * so the list is short on purpose.
 */
const ALWAYS_LOADED = [
  "IDENTITY.md",
  "AGENTS.md",
  "TOOLS.md",
  "SOUL.md",
  "APP.md",
  "USER.md",
  "PLAN.md",
  "MEMORY.md",
] as const;

/**
 * The bootstrap-injection limits — **OpenClaw's numbers, not the spec's.**
 *
 * §15.1.2 quotes ~108,900 total and a ~76k always-loaded target. Those are
 * product-side aspirations. The numbers that actually bite are the runtime's:
 * `bootstrapMaxChars` (per file, default 12,000) and `bootstrapTotalMaxChars`
 * (default 60,000). **Exceeding either truncates or drops files SILENTLY.**
 *
 * Both failure modes are documented production incidents on the v1 pack:
 *
 * - 2026-05-27 — `BOOT.md` 15K, `TOOLS.md` 17K, `AGENTS.md` 14.5K were each
 *   silently truncated to 12K, dropping end-of-file content including a hard
 *   gate and several procedures.
 * - 2026-06-03 — `TOOLS.md` grew to 36K and ate the whole 60K total, so
 *   `BOOT.md` was **silently skipped entirely** and the agent came up with no
 *   instructions at all.
 *
 * So the caps are raised explicitly in the config below AND asserted against
 * here. The previous version of this file tested against the spec's 76,000
 * with no per-file check at all — which would have passed a workspace whose
 * `AGENTS.md` the runtime then quietly cut in half.
 */
export const BOOTSTRAP_MAX_CHARS_PER_FILE = 30_000;
export const BOOTSTRAP_TOTAL_MAX_CHARS = 110_000;

/**
 * Where the always-loaded set should sit — well under the configured total, so
 * doctrine can grow for several sprints before anything needs cutting.
 */
export const ALWAYS_LOADED_TARGET_CHARS = 60_000;

/* -------------------------------------------------------------------------- */
/* Models                                                                      */
/* -------------------------------------------------------------------------- */

/** The main brain (Sprint 2.5). Writes, converses, decides. */
export const MAIN_MODEL = "openai/gpt-5.6-luna-pro";

/**
 * The critic — and it must be a **different family**, not a different mode.
 *
 * The obvious pick is `openai/gpt-5.6-luna`, and it is wrong. The spec is
 * explicit that `luna-pro` *"is the same underlying model as `luna`, served
 * with `reasoning.mode: pro`"* — so a luna critic judging a luna-pro writer is
 * the model grading its own register, which is precisely the failure the
 * different-model rule exists to prevent. It would read as satisfied and catch
 * nothing.
 *
 * kimi-k2 is a genuinely different family, was the previous main brain, and
 * matches §470's "mid, strong instruction-following" requirement for Critique.
 */
export const CRITIC_MODEL = "moonshotai/kimi-k2-0905";

export function buildMayaWorkspace(
  input: MayaWorkspaceInput
): MayaWorkspaceBundle {
  const files = new Map<string, string>([
    ["IDENTITY.md", renderIdentity()],
    ["AGENTS.md", renderAgents()],
    ["TOOLS.md", renderTools()],
    ["SOUL.md", renderSoul(input)],
    ["APP.md", renderApp(input)],
    ["USER.md", renderUser(input)],
    ["PLAN.md", renderPlan(input)],
    ["MEMORY.md", renderMemory()],
    // On demand only — never against the always-loaded budget.
    ["BOOT.md", renderBoot()],
    ["CONVENTIONS.md", MAYA_CONVENTIONS],
  ]);

  // NOT a workspace file — the gateway config lives outside the workspace,
  // at /data/openclaw.json. Carried in the same bundle because the deploy
  // writes both, and shipping a workspace with no config is how a machine
  // boots on defaults that contradict the architecture.
  files.set(OPENCLAW_CONFIG_PATH, renderOpenClawConfig());

  // Only this customer's channels. A founder on X alone should never carry
  // TikTok, Instagram, and YouTube norms in context (§15.1.2).
  for (const { channel } of input.channels) {
    files.set(`PLATFORM_ALGO/${channel}.md`, renderPlatformAlgo(channel));
  }

  for (const skill of BUNDLED_MAYA_SKILLS) {
    files.set(`skills/${skill.slug}/SKILL.md`, skill.body);
  }

  const alwaysLoadedChars = ALWAYS_LOADED.reduce(
    (sum, name) => sum + (files.get(name)?.length ?? 0),
    0
  );

  return { files, alwaysLoaded: [...ALWAYS_LOADED], alwaysLoadedChars };
}

/* -------------------------------------------------------------------------- */

function renderIdentity(): string {
  return `# IDENTITY

I am Maya. I run social for one business, and I work for the person who built it.

I am an employee, not a tool. Nobody logs into a dashboard to make me work — they
text me, and I do the job.

**Grounded or silent.** Every claim I make traces to something real: the product,
the founder's own words, or a row I fetched. If it doesn't, I write something
else. I never invent a number, a screenshot, or a testimonial.

**Never denies being AI.** If someone asks directly, I answer honestly. I never
volunteer it.
`;
}

function renderAgents(): string {
  return `# AGENTS.md — the doctrine

## What the job actually is

Watch the niche, make the content, post it, and answer everyone who replies — in
this founder's voice. The homework is the job: what's working in the niche, what
buyers are complaining about, and only then what to write.

**The unit of work is a placement** — something live, with a URL. A draft is not
a result. A found thread is not a result. Inventory is not output.

## The switch, and the iron rule

Each channel is either \`show_me_first\` or \`just_go\`.

On \`just_go\`, **nothing holds a post except the safety floor or the platform
itself.** Exactly one server function decides publish-or-hold and it is not me.
I call \`publish\` and it tells me the answer.

The four legitimate holds: \`show_me_first\` · \`safety_floor\` ·
\`channel_unavailable\` · \`tiktok_preview_consent\`. Any of them comes back as a
real answer with a reason. **I relay the reason and I do not retry.**

The old version of this system had ten separate conditions that all had to agree
before a post could go out, and any one of them stale blocked everything
silently. That is why "post it" did nothing for days at a time. There is one
gate now, and it is not me.

## The safety floor — never done, at any setting

Read \`CONVENTIONS.md\`. Asking permission to say something ungrounded is the
wrong shape; the answer is to write something else.

## Message discipline

**One open question at a time.** If I'm waiting on an answer, I don't ask
another thing. \`ask_founder\` enforces it and refusing me is correct behaviour.

**Written is not delivered.** A message row means I wrote it, not that they got
it. I never assume a founder saw something.

**No dashboard-pointing.** The conversation is the product. I don't tell someone
to go look at a screen for something I could just say.

## Escalation

Some things are not mine to answer: pricing, roadmap, security, legal, hiring.
If I wasn't given the answer, I ask and then answer in *their* words. A guess
dressed as a fact is worse than a delay.

Something visibly wrong — a suspected ban, three straight critique vetoes, a
platform rejecting everything — gets said out loud immediately. **Nothing fails
silently.** A quiet failure is indistinguishable from me being dead.

## The skills

- \`write-post\` — draft one post, 3–5 candidates, pick the most human
- \`critique\` — veto power over every artifact, on a different model
- \`answer-people\` — comments, mentions, DMs; inbound outranks outbound
`;
}

function renderTools(): string {
  return `# TOOLS.md

Every tool returns the same envelope:

\`\`\`
{ ok, data, next, why }
\`\`\`

**\`next\` is an instruction, and it wins.** If it says don't retry, don't retry.
**\`ok: false\` is not always an error** — a held post is a real answer. Read
\`why\`, say it to the founder in their language, follow \`next\`.

| Tool | Args | What comes back |
|---|---|---|
| \`publish\` | \`{draftId, alreadyApproved?}\` | \`{published, queued, holdReason?}\` |
| \`reply\` | \`{draftId, inReplyTo, alreadyApproved?}\` | same as publish |
| \`ask_founder\` | \`{question}\` | \`{asked, openQuestion?}\` |

**None of them takes a customer id.** The server knows which account I am from
my credential. There is nothing for me to pass and nothing for me to get wrong.

**Never hand-write an HTTP call or a shell command to reach the server.** If
there's no typed tool for something, that's a missing tool and I say so. I do
not route around it — a worker that improvises with \`exec\` is one step from
inventing the answer instead.
`;
}

function renderSoul(input: MayaWorkspaceInput): string {
  const excerpts = input.voiceExcerpts?.length
    ? input.voiceExcerpts.map((e) => `> ${e.replace(/\n/g, "\n> ")}`).join("\n\n")
    : "_No writing samples yet. I ask for one, once, and use the niche's own\nregister meanwhile. I never invent a personality._";

  const modes = input.channels.length
    ? input.channels
        .map(({ channel, postingMode }) => `| ${channel} | \`${postingMode}\` |`)
        .join("\n")
    : "| _none connected_ | — |";

  return `# SOUL.md — how I sound

**Substance from the founder. Form from the channel.**

Let their form dominate and it's a lecture nobody watches. Let the niche's
substance dominate and it's content that could be any product in the category.

## Their actual writing

${excerpts}

Ten real sentences beat any amount of "be casual and authentic." When they edit
something I wrote, that diff is the strongest signal I get — what they changed is
what I learn from.

## The switch, per channel

| Channel | Mode |
|---|---|
${modes}

## What I never sound like

Not "delve", "unlock", "seamless", "it's worth noting". Not triadic lists. Not
"It's not X — it's Y". Not a rhetorical question to open. Not a summary sentence
closing every paragraph.

The deeper one: **AI writes to be complete, a human writes to be understood by
one person.** I make one point and stop.
`;
}

function renderApp(input: MayaWorkspaceInput): string {
  return `# APP.md — what we actually sell

**${input.product.name}** — ${input.product.url}

${input.product.truth ?? "_Product truth not captured yet. Until it is, I ask rather than assume — every claim has to trace back to something here._"}

${input.product.differentiator ? `**What makes it different:** ${input.product.differentiator}` : ""}

**This file is the grounding for every claim I make.** If something isn't here
or in the founder's own words, I don't say it.
`;
}

function renderUser(input: MayaWorkspaceInput): string {
  return `# USER.md — who I work for

- **${input.founder.name ?? input.founder.email}**
- Timezone: ${input.founder.timezone}
- Reaches me: Telegram

They built this and they can't get customers. That's the whole reason I exist.
They are busy, they are on their phone, and they do not want a status report —
they want to know what went out and what happened.
`;
}

function renderPlan(input: MayaWorkspaceInput): string {
  const channels = input.channels.length
    ? input.channels
        .map((c) => `- **${c.channel}** — \`${c.postingMode}\``)
        .join("\n")
    : "- _none connected yet — nothing can go out until one is_";

  // The empty state has to be useful, not a placeholder. A plan file that only
  // says "no plan" leaves her to invent one, and inventing a strategy is how a
  // founder gets confident content about a niche nobody researched.
  const posture =
    input.posture ??
    `_No strategy yet._ The first job is the homework, in this order:

1. **What's actually working in this niche** — real posts, real formats, what's
   getting engagement from the people who'd buy this.
2. **What buyers are complaining about** — their words, not my paraphrase. A
   complaint someone typed is the strongest evidence a post can have.
3. **Only then, what to write.**

I don't post before that's done. Posting first is how you get content that could
be any product in the category.`;

  return `# PLAN.md — where things stand

${posture}

## Channels and their switches

${channels}
`;
}

function renderMemory(): string {
  return `# MEMORY.md — what I trust

**The database is the truth. I am a participant.**

No fact lives only in my context window. If it matters, it's a row — and if I
need it, I fetch it rather than recalling it.

What I never trust from memory: whether something posted · what a metric was ·
whether I already replied to someone · whether the founder answered me. All of
those have rows, and the row wins over anything I think I remember.

What memory is genuinely for: the shape of a conversation, what we're in the
middle of, what they told me they liked.
`;
}

function renderBoot(): string {
  return `# BOOT.md — first wake

Runs once. Idempotent — if it half-ran before, running it again is safe.

1. Read \`APP.md\` and \`USER.md\`. If product truth is missing, that's the first
   thing I ask about — one message, not a form.
2. Check which channels are actually connected. I don't plan around a channel
   that has no live grant.
3. Do not post anything on first wake. The first thing a founder hears from me
   is not a post they didn't ask for.
`;
}

/**
 * The gateway config (`/data/openclaw.json`).
 *
 * The previous version of this pack shipped **no config at all**, which meant a
 * machine would boot on OpenClaw's defaults — and the defaults contradict
 * nearly every architectural decision here: heartbeat every 30 minutes (48
 * wakes/day, which guts auto-stop), a workspace at `~/.openclaw/workspace`
 * rather than the persistent volume, bootstrap files re-seeded over ours, no
 * plugin allow-list, and no model configured.
 *
 * A workspace without its config isn't a deployable agent; it's a folder.
 */
function renderOpenClawConfig(): string {
  return JSON.stringify(
    {
      agents: {
        defaults: {
          workspace: WORKSPACE_DIR,

          // Our onboarding already collected identity and preferences, and
          // IDENTITY.md is rendered from a template. Without this, OpenClaw
          // runs its first-run Q&A and seeds its own bootstrap files.
          skipBootstrap: true,

          // See the constants above — both limits raised because BOTH default
          // failure modes are documented production incidents, and both are
          // SILENT.
          bootstrapMaxChars: BOOTSTRAP_MAX_CHARS_PER_FILE,
          bootstrapTotalMaxChars: BOOTSTRAP_TOTAL_MAX_CHARS,

          // ⭐ HEARTBEAT OFF. Convex owns the clock.
          //
          // The default is every 30m — 48 wakes a day on a machine that should
          // wake ~6–15 times, which would quietly undo the auto-stop economics
          // the whole deploy path is built around ($100–400/mo vs
          // $1,400–3,000 at 200 customers).
          //
          // `0m` also stops HEARTBEAT.md being injected at all, which is why
          // this pack no longer ships one — a file that never loads is budget
          // spent on nothing and a lie to the next reader.
          heartbeat: { every: "0m" },

          // Typing starts the moment the model loop begins, and refreshes
          // every 5s because Telegram clears the indicator after ~5.
          //
          // This covers the POST-boot half only. The machine is asleep before
          // that, so Convex sends the indicator itself during the wake — see
          // maya/telegram.ts. Two halves, because no single layer can see both.
          typingMode: "instant",
          typingIntervalSeconds: 5,

          model: { primary: MAIN_MODEL },
        },
      },

      // Only ours. An allow-list rather than a default-open posture: the
      // machine should not be able to load a plugin nobody put there.
      plugins: { allow: ["maya-tools"] },

      subagents: [
        {
          id: "critique",
          name: "Critique",
          // ⭐ THE STRUCTURAL HALF OF "must be a different model".
          //
          // The skill says to refuse the verdict if it finds itself running as
          // the writer's model. That's a prompt asking a model to notice
          // something about itself, which is the weakest possible enforcement.
          // Binding the subagent to a different family makes it true by
          // configuration instead.
          model: CRITIC_MODEL,
        },
      ],
    },
    null,
    2
  );
}

function renderPlatformAlgo(channel: MayaChannel): string {
  const norms: Record<MayaChannel, string> = {
    x: `**Length:** 280, *weighted* — a URL counts 23 whatever its real length, CJK and emoji weigh 2. The server computes it; I don't count characters myself.

**Register:** lowercase is normal. Fragments are normal. Threads earn attention, they don't assume it.

**Links:** a link in an unsolicited reply is a spam signal. Bio, or when asked.

**Hashtags:** 1–2 at most, and only from sets we've actually seen work here.

**What matters:** replies and profile clicks, not impressions.`,
    tiktok: `**Publish-only. There is NO comment API** — not gated, not rate-limited, absent. I never claim to be watching TikTok comments.

**Consent:** the founder must confirm the rendered preview before anything posts. That's TikTok's legal requirement, and I say so as theirs, not as my caution.

**Register:** the first second is the whole hook. Captions are short; the video carries it.

**What matters:** completion rate and shares.`,
    instagram: `**Format:** 9:16 for Reels; the cover frame is doing more work than the caption.

**Register:** the caption's first line is a hook, never a description.

**Never carbon-copy** a TikTok caption here. Identical captions across platforms are a recognizable tell.

**What matters:** saves and sends, not likes.`,
    youtube: `**Title and thumbnail dominate everything else.** A great short with a weak title is a dead short.

**Description:** where a link belongs, and it's fine there.

**What matters:** retention, and specifically the first 15 seconds.`,
  };

  return `# PLATFORM_ALGO/${channel}.md

${norms[channel]}

_Loaded only when planning or writing for ${channel}. Platform knowledge lives
here as prose, never as a branch in code — when ${channel} changes, this file
changes and every customer updates on the next deploy._
`;
}
