/**
 * assembleWorkspaceBundle — top-level orchestrator for a per-creator
 * OpenClaw workspace.
 *
 * Sprint 3.7 phase A. Calls the 7 file generators + the cron jobs.json
 * builder, returns a `Map<filename, content>` the deploy pipeline
 * serializes for upload to the Fly machine's persistent volume.
 *
 * Files emitted (per OpenClaw spec
 * `https://docs.openclaw.ai/concepts/agent-workspace.md`):
 *
 *   - `AGENTS.md`                                     — always
 *   - `SOUL.md`                                       — always (Sprint 2)
 *   - `IDENTITY.md`                                   — always (Sprint 2)
 *   - `USER.md`                                       — always
 *   - `HEARTBEAT.md`                                  — always
 *   - `BOOT.md`                                       — always
 *   - `MEMORY.md`                                     — always (initial seed)
 *   - `TOOLS.md`                                      — always
 *   - `DREAMING.md`                                   — always
 *   - `standing-orders.md`                            — only if AGENTS.md
 *                                                       embedded form
 *                                                       exceeds bootstrapMaxChars
 *   - `Operations/Daily Notes/README.md`              — always (seed)
 *   - `Operations/Daily Notes/<today-local>.md`       — always (seed)
 *
 * SOUL.md and IDENTITY.md were added in Sprint 2 (slice A) — the file
 * generators live alongside the others under `./generateSoulMd.ts` and
 * `./generateIdentityMd.ts`.
 *
 * Pure function. Deterministic for given inputs (with `now` pinned).
 */

import {
  generateAgentsMd,
  renderStandingOrdersDocument,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
} from "./generateAgentsMd";
import { generateUserMd, deriveDisplayName } from "./generateUserMd";
import { generateHeartbeatMd } from "./generateHeartbeatMd";
import { generateBootMd } from "./generateBootMd";
import { generateMemoryMdSeed } from "./generateMemoryMdSeed";
import { generateToolsMd } from "./generateToolsMd";
import { generateDreamingMd } from "./generateDreamingMd";
import { generateSoulMd } from "./generateSoulMd";
import { generateIdentityMd } from "./generateIdentityMd";
import { buildCronJobsJson, type JobsJson } from "./buildCronJobsJson";
import { BUNDLED_SKILLS } from "./skillsRegistry";
import {
  CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
  CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS,
} from "../../../../creatorMayaV0/pinnedClawhubSkills";
import type { WorkspaceInputs } from "./types";

export interface WorkspaceBundle {
  files: Map<string, string>;
  jobsJson: JobsJson;
  /** Whether AGENTS.md split standing orders into a separate file. */
  standingOrdersSplit: boolean;
}

export interface AssembleBundleOptions {
  /** OpenClaw bootstrap cap; defaults to 12,000. */
  bootstrapMaxChars?: number;
}

export function assembleWorkspaceBundle(
  inputs: WorkspaceInputs,
  options: AssembleBundleOptions = {}
): WorkspaceBundle {
  const { creator, picture, handles, plan, now } = inputs;
  const bootstrapMaxChars = options.bootstrapMaxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const displayName = deriveDisplayName(creator);

  const sortedHandlesForHeader = [...handles]
    .sort((a, b) => {
      if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
      return a.handle.localeCompare(b.handle);
    })
    .map((h) => ({ platform: h.platform, handle: h.handle }));

  // First, try the embedded form. If it overflows, fall back to split.
  const embedded = generateAgentsMd({
    creatorDisplayName: displayName,
    plan,
    handles: sortedHandlesForHeader,
    embedStandingOrders: true,
    bootstrapMaxChars,
  });
  let agentsMd: string;
  let standingOrdersSplit = false;
  if (embedded.length <= bootstrapMaxChars) {
    agentsMd = embedded;
  } else {
    agentsMd = generateAgentsMd({
      creatorDisplayName: displayName,
      plan,
      handles: sortedHandlesForHeader,
      embedStandingOrders: false,
      bootstrapMaxChars,
    });
    standingOrdersSplit = true;
  }

  const userMd = generateUserMd({
    creator,
    picture,
    handles,
    plan,
    followerSnapshots: inputs.followerSnapshots,
    now,
  });
  const heartbeatMd = generateHeartbeatMd({ plan });
  const bootMd = generateBootMd({ creatorDisplayName: displayName });
  const memoryMd = generateMemoryMdSeed({ creator, picture, handles, now });
  const toolsMd = generateToolsMd();
  const dreamingMd = generateDreamingMd();
  const soulMd = generateSoulMd({ creator, picture, plan });
  const identityMd = generateIdentityMd({ creator, picture });

  const files = new Map<string, string>();
  files.set("AGENTS.md", agentsMd);
  files.set("SOUL.md", soulMd);
  files.set("IDENTITY.md", identityMd);
  files.set("USER.md", userMd);
  files.set("HEARTBEAT.md", heartbeatMd);
  files.set("BOOT.md", bootMd);
  files.set("MEMORY.md", memoryMd);
  files.set("TOOLS.md", toolsMd);
  files.set("DREAMING.md", dreamingMd);
  if (standingOrdersSplit) {
    files.set("standing-orders.md", renderStandingOrdersDocument(plan));
  }

  // Operations / Daily Notes seed — README + today's empty note.
  const todayLocal = formatLocalDate(now, creator.timezone);
  files.set(
    "Operations/Daily Notes/README.md",
    [
      "# Daily Notes",
      "",
      "Append-only log Maya reads and writes during the day. Each file is one local-day. Maya appends notes after every cron tick that produced a creator-facing output (morning brief, evening recap, weekly review, post-publish reaction, brand-email triage, contract scan).",
      "",
      "Format conventions:",
      "",
      "- Filenames: `YYYY-MM-DD.md` in the creator's local timezone (`creators.timezone`).",
      "- Each entry: `## HH:MM <program>` heading, then a short note (one paragraph) about what fired and any open thread.",
      "- Old files are not garbage-collected — they're the audit trail.",
      "",
    ].join("\n")
  );
  files.set(
    `Operations/Daily Notes/${todayLocal}.md`,
    [
      `# ${todayLocal}`,
      "",
      "_(empty — Maya appends after the first cron tick today.)_",
      "",
    ].join("\n")
  );

  // Bundled agent skills — each ships as `skills/<slug>/SKILL.md` so OpenClaw's
  // skill loader auto-discovers them under the workspace's `skills/` tree.
  // The registry source-of-truth lives in `skillsRegistry.ts` (regenerated by
  // `scripts/sync-bundled-skills.ts` from the on-disk SKILL.md files).
  for (const skill of BUNDLED_SKILLS) {
    files.set(`skills/${skill.slug}/SKILL.md`, skill.content);
  }

  // Sprint 12.7.2 — pinned ClawHub vendor skills. Previously these were only
  // shipped via `creatorMayaV0/workspaceManifest.ts` (a parallel deploy path
  // not used by the live creator-Maya pipeline). The active path —
  // `configGeneratorMaya.ts` → `assembleWorkspaceBundle` — skipped them,
  // which is why `/data/workspace/skills/` on Kevin's machine had zero
  // ClawHub pins despite the lock file referencing 7.
  //
  // Sprint 12.7.5 (Sprint A.4) — added `g0atbot-tiktok-carousel` as the third
  // pin (photo-deck sibling to the video pipeline). `tiktok` +
  // `ffmpeg-video-editor` ship with real vendored content; the carousel pin
  // ships with a thorough placeholder SKILL.md (ClawHub registry was
  // flapping during the pin window — see pinnedClawhubSkills.ts comment
  // block for the rehydrate plan). The lock entry + slug are the source
  // of truth regardless of hydration state.
  files.set(
    ".clawhub/lock.json",
    `${JSON.stringify(CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK, null, 2)}\n`
  );
  for (const skill of CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS) {
    for (const [path, body] of Object.entries(skill.files)) {
      files.set(`skills/${skill.slug}/${path}`, body);
    }
  }

  // Sprint 9.5 — pass `firstBootKickstart: {}` so buildCronJobsJson decides
  // whether to emit the one-shot kickstart based on
  // `creator.firstBootCompletedAt`. We pass `now` as the `nowMsOverride` so
  // the embedded ISO timestamp is deterministic across re-runs of the same
  // bundle — the bundle hash (`hashConfig`) excludes `generatedAt` but the
  // workspace tarball is content-addressed, so determinism still matters.
  // Sprint 12.8 — structural fabrication gate. A profile-only picture means
  // the synth saw no scrapable posts (private / brand-new / empty scrape),
  // so there is no real warmthMaterial. The standard kickstart's "cite a
  // specific clip" beat, handed no real data, made the model invent one
  // from its own prompt examples (the "Piccadilly 1.1k vs 47" bleed across
  // three empty accounts). buildCronJobsJson swaps in the honest
  // content-blocked script when this is true — the gate is structural, not
  // a prompt the model can ignore.
  const noScrapedContent =
    picture == null || picture.model === "profile-only-fallback";
  const jobsJson = buildCronJobsJson({
    creator,
    noScrapedContent,
    firstBootKickstart: { nowMsOverride: now },
  });

  return { files, jobsJson, standingOrdersSplit };
}

/**
 * Format a unix-ms timestamp as `YYYY-MM-DD` in the given IANA timezone.
 *
 * We use Intl.DateTimeFormat with `en-CA` locale, which natively renders
 * ISO-style dates (YYYY-MM-DD) — the simplest deterministic way to get
 * the local date without pulling in a tz library.
 */
function formatLocalDate(unixMs: number, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(unixMs));
}
