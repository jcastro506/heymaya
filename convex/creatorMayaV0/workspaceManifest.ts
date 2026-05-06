/**
 * workspaceManifest — thin legacy adapter.
 *
 * Sprint 2 (slice A) deploy-path consolidation: this file used to carry its
 * own thin-stub generators for AGENTS.md / SOUL.md / USER.md / TOOLS.md /
 * HEARTBEAT.md / MEMORY.md / DREAMING.md / jobs.json plus 13 prose-only
 * `creator-*` skill stubs. All of that has been replaced by the canonical
 * generators under `convex/agents/packs/maya/workspace/`. The deploy path
 * now lives in `creatorMayaV0/backend.ts`'s `buildCreatorWorkspaceForDeploy`
 * helper which calls `assembleWorkspaceBundle` directly.
 *
 * This adapter is preserved for one consumer: the
 * `scripts/creator-maya-v0-fly-smoke.ts` Fly smoke driver, which needs a
 * `Record<string, string>` workspace bundle keyed by file path. The script
 * still drives Sprint 1's cron-fly-smoke + future Sprint 2 e2e tests; its
 * downstream grep-for-skill assertions live in the script's own
 * verifyMachine command and migrate when Slice C lands the new skill
 * bundling.
 *
 * Internally this delegates to `assembleWorkspaceBundle` and adapts the
 * v0 input shape onto the canonical `WorkspaceInputs`. The skill catalog
 * comes from `BUNDLED_SKILLS` (Slice C registry) + the pinned ClawHub
 * vendor pack (Slice D registry). Nothing is custom-stubbed in this file.
 */

import { assembleWorkspaceBundle } from "../agents/packs/maya/workspace/assembleWorkspaceBundle";
import type { WorkspaceInputs } from "../agents/packs/maya/workspace/types";
import type { Doc, Id } from "../_generated/dataModel";
import type { Plan } from "../lib/planFeatures";
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
  /**
   * Optional plan override for legacy callers; defaults to `manager`.
   */
  plan?: Plan;
  /** Optional creator email; falls back to a stable test placeholder. */
  email?: string;
  /** Optional pinned timestamp for deterministic test bundles. */
  now?: number;
}

export interface CreatorMayaWorkspaceManifest {
  files: Record<string, string>;
}

/**
 * Slug list retained for vocabulary stability in the deploy gate's blocker
 * messages and the smoke script. The actual SKILL.md content now lives in
 * the on-disk `agents/skills/<slug>/SKILL.md` files registered through
 * `BUNDLED_SKILLS` (Slice C).
 */
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
  "creator-tiktok-draft-handoff",
  "creator-account-deletion-confirmation",
] as const;

/**
 * Adapt the legacy v0 input shape onto canonical `WorkspaceInputs`,
 * delegate to `assembleWorkspaceBundle`, then layer pinned ClawHub vendor
 * skills + lock manifest on top so the legacy disk layout is preserved.
 *
 * Throws when calendar isn't connected, matching the historical contract
 * (the deploy gate also enforces this; the throw here is defense-in-depth).
 */
export function buildCreatorMayaWorkspaceManifest(
  input: CreatorMayaWorkspaceInput
): CreatorMayaWorkspaceManifest {
  if (!input.calendarConnected) {
    throw new Error("Creator Maya workspace requires connected calendar.");
  }

  const plan: Plan = input.plan ?? "manager";
  const now = input.now ?? Date.now();

  const creator = {
    _id: input.creatorId as unknown as Id<"creators">,
    _creationTime: now,
    clerkUserId: `legacy_${input.creatorId}`,
    email: input.email ?? `${input.creatorId}@legacy.heymaya.local`,
    channelPreference: "imessage" as const,
    timezone: input.timezone,
    status: "active" as const,
    plan,
    createdAt: now,
  } as Doc<"creators">;

  const picture: Doc<"creatorPicture"> = {
    _id: `legacy_picture_${input.creatorId}` as unknown as Id<"creatorPicture">,
    _creationTime: now,
    creatorId: creator._id,
    niche: input.creatorPicture.niche,
    audience: { ageRanges: [], topGeos: [], interestTags: [] },
    voiceFingerprint: input.creatorPicture.voiceFingerprint,
    topHooks: [],
    bottomHooks: [],
    postingCadence: { perPlatform: [] },
    brandDealHistory: [],
    generatedAt: now,
    model: "legacy-adapter",
    sourceCitations: [],
  };

  const handles: ReadonlyArray<Doc<"creatorHandles">> = [
    {
      _id: `legacy_handle_${input.creatorId}` as unknown as Id<"creatorHandles">,
      _creationTime: now,
      creatorId: creator._id,
      platform: "tiktok",
      handle: input.tiktokHandle.startsWith("@")
        ? input.tiktokHandle
        : `@${input.tiktokHandle}`,
      verified: true,
    } as Doc<"creatorHandles">,
  ];

  const inputs: WorkspaceInputs = {
    creator,
    picture,
    handles,
    connectedAccounts: [],
    plan,
    now,
  };

  const bundle = assembleWorkspaceBundle(inputs);

  const files: Record<string, string> = {};
  for (const [name, content] of bundle.files) {
    files[name] = content;
  }
  files["jobs.json"] = JSON.stringify(bundle.jobsJson, null, 2);

  // Pinned ClawHub vendor skills + lock manifest (Slice D registry).
  files[".clawhub/lock.json"] = `${JSON.stringify(
    CREATOR_MAYA_V0_PINNED_CLAWHUB_LOCK,
    null,
    2
  )}\n`;
  for (const skill of CREATOR_MAYA_V0_PINNED_CLAWHUB_SKILLS) {
    for (const [path, body] of Object.entries(skill.files)) {
      files[`skills/${skill.slug}/${path}`] = body;
    }
  }

  return { files };
}
