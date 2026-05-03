/**
 * maya-skill-installer — meta-skill, security-gated discovery + install workflow.
 *
 * Per § 8.5: this is the operator-gated extension path. NO LLM call —
 * pure rule-based registry search + risk classification + audit logging.
 *
 * Security gates (LOAD-BEARING — every gate enforced server-side):
 *   1. Plan-tier: Pro+ only. Starter rejected at the entry-point.
 *   2. verifiedOnly defaults true; flipping false → red warning + audit log.
 *   3. Curated allowlist of permissible tool requests at fetch stage.
 *      Any candidate requesting `raw-fs-write`, `arbitrary-http`, etc. is
 *      added to `blockedCandidates` and never shown to the operator.
 *   4. Operator approval REQUIRED for every install — `approvalLink` is
 *      returned as a Convex action URL the operator must click.
 *   5. Version-pinned per business — re-install of same name+version is a
 *      no-op + audit-logged.
 *
 * The skill itself is pure (testable). Network registry calls + Convex
 * audit-log writes happen in the orchestrator action; we accept them as
 * dependency-injected interfaces.
 */

export type SkillRegistry = "clawhub" | "skills.sh" | "both";

export type SkillRiskFlag =
  | "unverified"
  | "high-permission-count"
  | "recently-published"
  | "low-install-count"
  | "permission-creep";

export type SkillBlockReason =
  | "unknown-permission"
  | "raw-fs-write"
  | "arbitrary-http"
  | "rejected-by-allowlist";

export interface SkillInstallerInputs {
  capabilityDescription: string;
  preferredRegistry: SkillRegistry;
  verifiedOnly?: boolean;
  searchContext?: string;
  businessId: string;
  operatorUserId: string;
  /** Plan tier passed in by orchestrator after fail-closed lookup. */
  planTier: "starter" | "pro" | "studio";
}

export interface SkillCandidate {
  name: string;
  sourceUrl: string;
  author: string;
  installCount?: number;
  verified: boolean;
  requestedPermissions: ReadonlyArray<string>;
  riskFlags: ReadonlyArray<SkillRiskFlag>;
  description: string;
}

export interface SkillBlockedCandidate {
  name: string;
  sourceUrl: string;
  blockedReason: SkillBlockReason;
}

export interface SkillInstallerOutput {
  candidates: ReadonlyArray<SkillCandidate>;
  blockedCandidates: ReadonlyArray<SkillBlockedCandidate>;
  approvalLink: string;
  searchAuditId: string;
}

export interface RegistryCandidate {
  registry: "clawhub" | "skills.sh";
  name: string;
  sourceUrl: string;
  author: string;
  installCount?: number;
  verified: boolean;
  requestedPermissions: ReadonlyArray<string>;
  publishedAt: number;
  description: string;
}

export interface RegistrySearcher {
  (query: {
    capabilityDescription: string;
    registry: SkillRegistry;
    verifiedOnly: boolean;
  }): Promise<RegistryCandidate[]>;
}

export interface AuditLogger {
  (entry: {
    businessId: string;
    operatorUserId: string;
    action: "search" | "install" | "uninstall";
    payload: Record<string, unknown>;
  }): Promise<{ auditId: string }>;
}

export interface ApprovalLinkBuilder {
  (input: { businessId: string; auditId: string; candidates: ReadonlyArray<SkillCandidate> }): string;
}

export class SkillInstallerPlanError extends Error {
  constructor(public readonly plan: string) {
    super(
      `maya-skill-installer: plan '${plan}' cannot use the skill installer (Pro+ required)`
    );
    this.name = "SkillInstallerPlanError";
  }
}

// Curated allowlist per § 8.5. Any candidate requesting a permission outside
// this set is rejected pre-presentation.
export const PERMISSION_ALLOWLIST: ReadonlySet<string> = new Set([
  "read:gbp",
  "read:reviews",
  "read:jobs",
  "read:customers",
  "read:competitor-snapshots",
  "read:media-assets",
  "write:draft-only", // drafts persisted but never auto-published
  "compute:llm-call",
  "compute:vision-call",
  "compute:pdf-render",
  "compute:hash",
]);

// Hard-blocked permission names — even if they show up phrased innocently,
// the search-stage filter rejects them.
export const HARD_BLOCKED_PERMISSIONS: Map<string, SkillBlockReason> = new Map([
  ["raw-fs-write", "raw-fs-write"],
  ["fs:write", "raw-fs-write"],
  ["filesystem", "raw-fs-write"],
  ["arbitrary-http", "arbitrary-http"],
  ["http:any", "arbitrary-http"],
  ["network:unrestricted", "arbitrary-http"],
  ["shell-exec", "arbitrary-http"],
  ["env:read-secrets", "rejected-by-allowlist"],
]);

const HIGH_PERMISSION_THRESHOLD = 6;
const RECENT_PUBLISH_DAYS = 14;
const LOW_INSTALL_THRESHOLD = 50;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function classifyCandidate(c: RegistryCandidate): {
  blocked?: SkillBlockReason;
  riskFlags: SkillRiskFlag[];
} {
  // 1. Hard-blocked permissions: any match → block.
  for (const perm of c.requestedPermissions) {
    const reason = HARD_BLOCKED_PERMISSIONS.get(perm.toLowerCase().trim());
    if (reason) return { blocked: reason, riskFlags: [] };
  }
  // 2. Allowlist: any unknown permission → block.
  for (const perm of c.requestedPermissions) {
    if (!PERMISSION_ALLOWLIST.has(perm)) {
      return { blocked: "unknown-permission", riskFlags: [] };
    }
  }
  // 3. Risk flags (informational; not blocked).
  const riskFlags: SkillRiskFlag[] = [];
  if (!c.verified) riskFlags.push("unverified");
  if (c.requestedPermissions.length >= HIGH_PERMISSION_THRESHOLD) {
    riskFlags.push("high-permission-count");
  }
  if (Date.now() - c.publishedAt < RECENT_PUBLISH_DAYS * MS_PER_DAY) {
    riskFlags.push("recently-published");
  }
  if ((c.installCount ?? 0) < LOW_INSTALL_THRESHOLD) {
    riskFlags.push("low-install-count");
  }
  return { riskFlags };
}

function rankScore(c: SkillCandidate): number {
  // Higher score = better-ranked candidate.
  let score = 0;
  if (c.verified) score += 3;
  score += Math.log10((c.installCount ?? 0) + 1) * 2;
  score -= c.riskFlags.length * 0.5;
  return score;
}

export interface SearchAndInstallDeps {
  registrySearcher: RegistrySearcher;
  auditLogger: AuditLogger;
  approvalLinkBuilder: ApprovalLinkBuilder;
}

export async function searchAndInstallSkill(
  inputs: SkillInstallerInputs,
  deps: SearchAndInstallDeps
): Promise<SkillInstallerOutput> {
  // Plan-tier gate (server-side fail-closed).
  if (inputs.planTier !== "pro" && inputs.planTier !== "studio") {
    throw new SkillInstallerPlanError(inputs.planTier);
  }

  const verifiedOnly = inputs.verifiedOnly !== false; // default true

  // Audit log: search.
  const auditEntry = await deps.auditLogger({
    businessId: inputs.businessId,
    operatorUserId: inputs.operatorUserId,
    action: "search",
    payload: {
      capabilityDescription: inputs.capabilityDescription,
      preferredRegistry: inputs.preferredRegistry,
      verifiedOnly,
      searchContext: inputs.searchContext ?? null,
    },
  });

  let registryResults: RegistryCandidate[];
  try {
    registryResults = await deps.registrySearcher({
      capabilityDescription: inputs.capabilityDescription,
      registry: inputs.preferredRegistry,
      verifiedOnly,
    });
  } catch (err) {
    return {
      candidates: [],
      blockedCandidates: [],
      approvalLink: "",
      searchAuditId: auditEntry.auditId,
    };
  }

  const candidates: SkillCandidate[] = [];
  const blockedCandidates: SkillBlockedCandidate[] = [];

  for (const r of registryResults) {
    const { blocked, riskFlags } = classifyCandidate(r);
    if (blocked) {
      blockedCandidates.push({
        name: r.name,
        sourceUrl: r.sourceUrl,
        blockedReason: blocked,
      });
      continue;
    }
    // verifiedOnly enforcement (defense-in-depth even if registry honored it).
    if (verifiedOnly && !r.verified) {
      blockedCandidates.push({
        name: r.name,
        sourceUrl: r.sourceUrl,
        blockedReason: "rejected-by-allowlist",
      });
      continue;
    }
    candidates.push({
      name: r.name,
      sourceUrl: r.sourceUrl,
      author: r.author,
      installCount: r.installCount,
      verified: r.verified,
      requestedPermissions: r.requestedPermissions,
      riskFlags,
      description: r.description,
    });
  }

  candidates.sort((a, b) => rankScore(b) - rankScore(a));
  const top5 = candidates.slice(0, 5);

  const approvalLink = deps.approvalLinkBuilder({
    businessId: inputs.businessId,
    auditId: auditEntry.auditId,
    candidates: top5,
  });

  return {
    candidates: top5,
    blockedCandidates,
    approvalLink,
    searchAuditId: auditEntry.auditId,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Install confirmation step — operator-clicked the approval link.
// Idempotency + audit logging happens here.
// ───────────────────────────────────────────────────────────────────────

export interface InstallConfirmInputs {
  businessId: string;
  operatorUserId: string;
  candidate: SkillCandidate;
  approvalToken: string;
  /** Existing customSkills row by businessId+name; orchestrator pre-fetches. */
  existingInstalled?: {
    skillName: string;
    version: string;
    archivedAt?: number;
  };
  /** Server-derived expected token, generated when approvalLink was built. */
  expectedApprovalToken: string;
  version: string;
}

export interface InstallConfirmOutput {
  installed: boolean;
  reason: "installed" | "no-op-already-installed" | "approval-token-mismatch";
  auditId: string;
}

export async function confirmInstall(
  inputs: InstallConfirmInputs,
  auditLogger: AuditLogger
): Promise<InstallConfirmOutput> {
  // Operator-approval-bypass guard: token must match exactly.
  if (inputs.approvalToken !== inputs.expectedApprovalToken) {
    const audit = await auditLogger({
      businessId: inputs.businessId,
      operatorUserId: inputs.operatorUserId,
      action: "install",
      payload: {
        attempted: inputs.candidate.name,
        rejected: "approval-token-mismatch",
      },
    });
    return {
      installed: false,
      reason: "approval-token-mismatch",
      auditId: audit.auditId,
    };
  }

  // Idempotency: same name+version + not archived = no-op.
  if (
    inputs.existingInstalled &&
    inputs.existingInstalled.skillName === inputs.candidate.name &&
    inputs.existingInstalled.version === inputs.version &&
    !inputs.existingInstalled.archivedAt
  ) {
    const audit = await auditLogger({
      businessId: inputs.businessId,
      operatorUserId: inputs.operatorUserId,
      action: "install",
      payload: {
        skill: inputs.candidate.name,
        version: inputs.version,
        result: "no-op-already-installed",
      },
    });
    return {
      installed: false,
      reason: "no-op-already-installed",
      auditId: audit.auditId,
    };
  }

  const audit = await auditLogger({
    businessId: inputs.businessId,
    operatorUserId: inputs.operatorUserId,
    action: "install",
    payload: {
      skill: inputs.candidate.name,
      version: inputs.version,
      sourceUrl: inputs.candidate.sourceUrl,
      verified: inputs.candidate.verified,
      requestedPermissions: inputs.candidate.requestedPermissions,
      riskFlags: inputs.candidate.riskFlags,
    },
  });
  return {
    installed: true,
    reason: "installed",
    auditId: audit.auditId,
  };
}

export const SKILL_METADATA = {
  name: "maya-skill-installer" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "medium" as const,
  planTier: ["pro", "studio"] as const,
  /** Hard security defaults per § 8.5 — never overridable. */
  defaultVerifiedOnly: true as const,
  operatorApprovalRequired: true as const,
  autoUpgradeForbidden: true as const,
};

export const __test__ = {
  classifyCandidate,
  rankScore,
  PERMISSION_ALLOWLIST,
  HARD_BLOCKED_PERMISSIONS,
};
