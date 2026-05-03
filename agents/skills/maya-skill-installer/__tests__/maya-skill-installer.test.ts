import { describe, it, expect, vi } from "vitest";
import {
  searchAndInstallSkill,
  confirmInstall,
  SkillInstallerPlanError,
  SKILL_METADATA,
  __test__,
  type SkillInstallerInputs,
  type SearchAndInstallDeps,
  type RegistryCandidate,
  type AuditLogger,
  type RegistrySearcher,
  type ApprovalLinkBuilder,
} from "../script";

const NOW = Date.now();
const ONE_DAY = 1000 * 60 * 60 * 24;

const baseInputs: SkillInstallerInputs = {
  capabilityDescription: "extract structured data from drone-footage roofing photos",
  preferredRegistry: "clawhub",
  businessId: "biz_a",
  operatorUserId: "user_a",
  planTier: "pro",
};

function searcher(results: RegistryCandidate[]): RegistrySearcher {
  return vi.fn(async () => results);
}

const okAuditLogger = (): AuditLogger => {
  let n = 0;
  return vi.fn(async () => ({ auditId: `audit_${++n}` }));
};

const okApprovalLinkBuilder: ApprovalLinkBuilder = vi.fn(
  ({ businessId, auditId }) =>
    `https://heymaya.app/approve?biz=${businessId}&audit=${auditId}`
);

function deps(
  results: RegistryCandidate[],
  customLogger?: AuditLogger
): SearchAndInstallDeps {
  return {
    registrySearcher: searcher(results),
    auditLogger: customLogger ?? okAuditLogger(),
    approvalLinkBuilder: okApprovalLinkBuilder,
  };
}

describe("maya-skill-installer — contract", () => {
  it("declares Pro+ + verified-only-default + operator-approval-required + auto-upgrade-forbidden", () => {
    expect(SKILL_METADATA.planTier).toEqual(["pro", "studio"]);
    expect(SKILL_METADATA.defaultVerifiedOnly).toBe(true);
    expect(SKILL_METADATA.operatorApprovalRequired).toBe(true);
    expect(SKILL_METADATA.autoUpgradeForbidden).toBe(true);
  });
});

describe("maya-skill-installer — plan-tier (fail-closed)", () => {
  it("Starter blocked at entry-point", async () => {
    await expect(
      searchAndInstallSkill(
        { ...baseInputs, planTier: "starter" },
        deps([])
      )
    ).rejects.toBeInstanceOf(SkillInstallerPlanError);
  });

  it("Pro permitted", async () => {
    const out = await searchAndInstallSkill(baseInputs, deps([]));
    expect(out).toBeDefined();
  });

  it("Studio permitted", async () => {
    const out = await searchAndInstallSkill(
      { ...baseInputs, planTier: "studio" },
      deps([])
    );
    expect(out).toBeDefined();
  });
});

describe("maya-skill-installer — adversarial: malicious manifests", () => {
  it("rejects raw-fs-write request pre-presentation", async () => {
    const malicious: RegistryCandidate = {
      registry: "clawhub",
      name: "shady-skill",
      sourceUrl: "https://clawhub.example/shady",
      author: "unknown",
      installCount: 1000,
      verified: true,
      requestedPermissions: ["read:gbp", "raw-fs-write"],
      publishedAt: NOW - 100 * ONE_DAY,
      description: "innocuous description",
    };
    const out = await searchAndInstallSkill(baseInputs, deps([malicious]));
    expect(out.candidates.length).toBe(0);
    expect(out.blockedCandidates.length).toBe(1);
    expect(out.blockedCandidates[0].blockedReason).toBe("raw-fs-write");
  });

  it("rejects arbitrary-http", async () => {
    const candidate: RegistryCandidate = {
      registry: "clawhub",
      name: "http-skill",
      sourceUrl: "https://clawhub.example/http",
      author: "x",
      installCount: 100,
      verified: true,
      requestedPermissions: ["read:gbp", "arbitrary-http"],
      publishedAt: NOW - 100 * ONE_DAY,
      description: "x",
    };
    const out = await searchAndInstallSkill(baseInputs, deps([candidate]));
    expect(out.blockedCandidates[0].blockedReason).toBe("arbitrary-http");
  });

  it("rejects unknown permission (not on allowlist)", async () => {
    const candidate: RegistryCandidate = {
      registry: "clawhub",
      name: "unknown-perm",
      sourceUrl: "https://clawhub.example/unknown",
      author: "x",
      installCount: 100,
      verified: true,
      requestedPermissions: ["read:gbp", "scan-customer-creditcards"],
      publishedAt: NOW - 100 * ONE_DAY,
      description: "x",
    };
    const out = await searchAndInstallSkill(baseInputs, deps([candidate]));
    expect(out.blockedCandidates[0].blockedReason).toBe("unknown-permission");
  });

  it("rejects unverified candidate when verifiedOnly=true (default)", async () => {
    const candidate: RegistryCandidate = {
      registry: "clawhub",
      name: "unverified-skill",
      sourceUrl: "https://clawhub.example/unv",
      author: "anon",
      installCount: 5,
      verified: false,
      requestedPermissions: ["read:gbp"],
      publishedAt: NOW - 5 * ONE_DAY,
      description: "x",
    };
    const out = await searchAndInstallSkill(baseInputs, deps([candidate]));
    expect(out.candidates.length).toBe(0);
    expect(out.blockedCandidates[0].blockedReason).toBe("rejected-by-allowlist");
  });

  it("permission-creep: candidate looks fine but requests an excessive surface (high-permission-count flag)", async () => {
    const candidate: RegistryCandidate = {
      registry: "clawhub",
      name: "feature-bloat",
      sourceUrl: "https://clawhub.example/bloat",
      author: "x",
      installCount: 200,
      verified: true,
      // 7 allowlisted permissions — passes block-list but trips high-permission-count
      requestedPermissions: [
        "read:gbp",
        "read:reviews",
        "read:jobs",
        "read:customers",
        "read:competitor-snapshots",
        "read:media-assets",
        "compute:llm-call",
      ],
      publishedAt: NOW - 100 * ONE_DAY,
      description: "x",
    };
    const out = await searchAndInstallSkill(baseInputs, deps([candidate]));
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].riskFlags).toContain("high-permission-count");
  });
});

describe("maya-skill-installer — happy path", () => {
  const goodCandidate: RegistryCandidate = {
    registry: "clawhub",
    name: "drone-photogrammetry",
    sourceUrl: "https://clawhub.example/drone-photogrammetry",
    author: "trusted-author",
    installCount: 5000,
    verified: true,
    requestedPermissions: ["read:media-assets", "compute:vision-call"],
    publishedAt: NOW - 200 * ONE_DAY,
    description: "Roofing drone photo structured-data extractor",
  };

  it("returns ranked candidate + approval link", async () => {
    const out = await searchAndInstallSkill(
      baseInputs,
      deps([goodCandidate])
    );
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].name).toBe("drone-photogrammetry");
    expect(out.approvalLink).toContain("biz_a");
    expect(out.searchAuditId).toMatch(/audit_/);
  });

  it("verified candidates rank higher than unverified", async () => {
    const a: RegistryCandidate = { ...goodCandidate };
    const b: RegistryCandidate = {
      ...goodCandidate,
      name: "lower-rank",
      verified: false,
    };
    const out = await searchAndInstallSkill(
      { ...baseInputs, verifiedOnly: false },
      deps([b, a])
    );
    expect(out.candidates[0].name).toBe("drone-photogrammetry");
  });

  it("limits to top 5 even with many candidates", async () => {
    const many: RegistryCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      ...goodCandidate,
      name: `skill-${i}`,
      installCount: 1000 - i,
    }));
    const out = await searchAndInstallSkill(baseInputs, deps(many));
    expect(out.candidates.length).toBeLessThanOrEqual(5);
  });

  it("audit logs every search", async () => {
    const logger = okAuditLogger();
    await searchAndInstallSkill(baseInputs, {
      registrySearcher: searcher([goodCandidate]),
      auditLogger: logger,
      approvalLinkBuilder: okApprovalLinkBuilder,
    });
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz_a",
        operatorUserId: "user_a",
        action: "search",
      })
    );
  });
});

describe("maya-skill-installer — cross-tenant safety", () => {
  it("Business A's installs never visible in Business B's search", async () => {
    const goodA: RegistryCandidate = {
      registry: "clawhub",
      name: "skill-a",
      sourceUrl: "https://clawhub.example/a",
      author: "x",
      installCount: 100,
      verified: true,
      requestedPermissions: ["read:gbp"],
      publishedAt: NOW - 50 * ONE_DAY,
      description: "x",
    };
    // Each call to searchAndInstallSkill produces its OWN candidates list.
    // The skill is stateless; cross-tenant isolation is enforced by the
    // orchestrator's businessId scope on auditLogger writes.
    const aOut = await searchAndInstallSkill(baseInputs, deps([goodA]));
    const bOut = await searchAndInstallSkill(
      { ...baseInputs, businessId: "biz_b", operatorUserId: "user_b" },
      deps([])
    );
    expect(aOut.candidates.map((c) => c.name)).toContain("skill-a");
    expect(bOut.candidates.map((c) => c.name)).not.toContain("skill-a");
  });
});

// ────────────────────────────────────────────────────────────────────────
// confirmInstall: operator-approval-bypass + idempotency
// ────────────────────────────────────────────────────────────────────────

describe("maya-skill-installer — confirmInstall: operator approval bypass", () => {
  const goodCandidate = {
    name: "ok-skill",
    sourceUrl: "https://clawhub.example/ok",
    author: "x",
    installCount: 100,
    verified: true,
    requestedPermissions: ["read:gbp"],
    riskFlags: [],
    description: "x",
  };

  it("rejects forged/mismatched approval token", async () => {
    const logger = okAuditLogger();
    const out = await confirmInstall(
      {
        businessId: "biz_a",
        operatorUserId: "user_a",
        candidate: goodCandidate,
        approvalToken: "FORGED_TOKEN_BY_ATTACKER",
        expectedApprovalToken: "REAL_TOKEN_xyz123",
        version: "1.0.0",
      },
      logger
    );
    expect(out.installed).toBe(false);
    expect(out.reason).toBe("approval-token-mismatch");
  });

  it("idempotency: re-install of same name+version is no-op + audit-logged", async () => {
    const logger = okAuditLogger();
    const out = await confirmInstall(
      {
        businessId: "biz_a",
        operatorUserId: "user_a",
        candidate: goodCandidate,
        approvalToken: "REAL_TOKEN_xyz123",
        expectedApprovalToken: "REAL_TOKEN_xyz123",
        version: "1.0.0",
        existingInstalled: {
          skillName: "ok-skill",
          version: "1.0.0",
          archivedAt: undefined,
        },
      },
      logger
    );
    expect(out.installed).toBe(false);
    expect(out.reason).toBe("no-op-already-installed");
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "install",
        payload: expect.objectContaining({
          result: "no-op-already-installed",
        }),
      })
    );
  });

  it("happy path: token matches + no prior install → installed", async () => {
    const logger = okAuditLogger();
    const out = await confirmInstall(
      {
        businessId: "biz_a",
        operatorUserId: "user_a",
        candidate: goodCandidate,
        approvalToken: "REAL_TOKEN_xyz123",
        expectedApprovalToken: "REAL_TOKEN_xyz123",
        version: "1.0.0",
      },
      logger
    );
    expect(out.installed).toBe(true);
    expect(out.reason).toBe("installed");
  });

  it("re-install of an archived install (uninstalled then re-installed) installs", async () => {
    const logger = okAuditLogger();
    const out = await confirmInstall(
      {
        businessId: "biz_a",
        operatorUserId: "user_a",
        candidate: goodCandidate,
        approvalToken: "REAL_TOKEN_xyz123",
        expectedApprovalToken: "REAL_TOKEN_xyz123",
        version: "1.0.0",
        existingInstalled: {
          skillName: "ok-skill",
          version: "1.0.0",
          archivedAt: NOW - 7 * ONE_DAY,
        },
      },
      logger
    );
    expect(out.installed).toBe(true);
  });
});

describe("maya-skill-installer — sibling-file scan", () => {
  it("never throws Sprint 3.5 stub error", async () => {
    await expect(searchAndInstallSkill(baseInputs, deps([]))).resolves.toBeDefined();
  });
});

describe("maya-skill-installer — helpers", () => {
  it("PERMISSION_ALLOWLIST contains all expected scopes", () => {
    expect(__test__.PERMISSION_ALLOWLIST.has("read:gbp")).toBe(true);
    expect(__test__.PERMISSION_ALLOWLIST.has("compute:llm-call")).toBe(true);
    expect(__test__.PERMISSION_ALLOWLIST.has("raw-fs-write")).toBe(false);
  });

  it("classifyCandidate flags all 4 risk dimensions", () => {
    const c: RegistryCandidate = {
      registry: "clawhub",
      name: "x",
      sourceUrl: "x",
      author: "x",
      installCount: 5, // low-install
      verified: false, // unverified
      requestedPermissions: [
        "read:gbp",
        "read:reviews",
        "read:jobs",
        "read:customers",
        "read:competitor-snapshots",
        "read:media-assets",
        "compute:llm-call",
      ], // high-perm-count
      publishedAt: NOW - 1 * ONE_DAY, // recently-published
      description: "x",
    };
    const { riskFlags } = __test__.classifyCandidate(c);
    expect(riskFlags).toContain("unverified");
    expect(riskFlags).toContain("high-permission-count");
    expect(riskFlags).toContain("recently-published");
    expect(riskFlags).toContain("low-install-count");
  });
});
