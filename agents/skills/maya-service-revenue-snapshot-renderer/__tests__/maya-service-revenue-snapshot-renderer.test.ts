import { describe, it, expect, vi } from "vitest";
import {
  renderRevenueSnapshot,
  SKILL_METADATA,
  __test__,
  type RevenueSnapshotInputs,
  type LlmCaller,
} from "../script";

const NOW = 1_700_000_000_000;
const ONE_DAY = 1000 * 60 * 60 * 24;

const baseInputs: RevenueSnapshotInputs = {
  crmJobs: [
    {
      id: "job_a",
      customerLastName: "Henderson",
      serviceType: "HVAC tune",
      completedAt: NOW - 2 * ONE_DAY,
      ticketAmount: 350,
    },
    {
      id: "job_b",
      customerLastName: "Wong",
      serviceType: "drain clean",
      completedAt: NOW - 4 * ONE_DAY,
      ticketAmount: 280,
    },
    {
      id: "job_c",
      customerLastName: "Brown",
      serviceType: "AC install",
      completedAt: NOW - 5 * ONE_DAY,
      ticketAmount: 4200,
    },
  ],
  crmInvoices: [
    {
      id: "inv_a",
      jobId: "job_a",
      amount: 350,
      paidAt: NOW - 1 * ONE_DAY,
      issuedAt: NOW - 2 * ONE_DAY,
    },
    {
      id: "inv_b",
      jobId: "job_b",
      amount: 280,
      paidAt: null,
      issuedAt: NOW - 4 * ONE_DAY,
    },
    {
      id: "inv_c",
      jobId: "job_c",
      amount: 4200,
      paidAt: null,
      issuedAt: NOW - 35 * ONE_DAY, // aged > 30d
    },
  ],
  priorWeekBaseline: {
    completedRevenue: 4500,
    paidRevenue: 3800,
    outstandingTotal: 700,
    avgTicket: 1100,
  },
  windowStart: NOW - 7 * ONE_DAY,
  windowEnd: NOW,
};

describe("maya-service-revenue-snapshot-renderer — contract", () => {
  it("declares HIGH thinking + Pro+ + CRM-required", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("high");
    expect(SKILL_METADATA.planTier).toEqual(["pro", "studio"]);
    expect(SKILL_METADATA.requiresCrm).toBe(true);
  });
});

describe("maya-service-revenue-snapshot-renderer — happy path", () => {
  it("computes window metrics correctly", async () => {
    const out = await renderRevenueSnapshot(baseInputs);
    expect(out.citationManifest.length).toBe(3);
    expect(out.comparisons.outstandingFlag).toBe(true); // job_c is aged
  });

  it("uses LLM prose when provided", async () => {
    const llm: LlmCaller = vi.fn(
      async () =>
        "3 completed jobs this week — $4.8K completed revenue, with $4.2K aged across 1 invoice. Worth a follow-up call."
    );
    const out = await renderRevenueSnapshot(baseInputs, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(out.snapshotProse).toContain("3 completed jobs");
  });

  it("flat week produces 'steady' anti-fake-busy message", async () => {
    const flatInputs: RevenueSnapshotInputs = {
      ...baseInputs,
      priorWeekBaseline: {
        completedRevenue: 4830, // ≈ same as window total 4830
        paidRevenue: 350,
        outstandingTotal: 700,
        avgTicket: 1610,
      },
    };
    const out = await renderRevenueSnapshot(flatInputs);
    expect(out.snapshotProse.toLowerCase()).toContain("steady week");
  });
});

describe("maya-service-revenue-snapshot-renderer — adversarial", () => {
  it("empty crmJobs → 'no completed jobs in this window' + comparisons skipped", async () => {
    const out = await renderRevenueSnapshot({
      ...baseInputs,
      crmJobs: [],
    });
    expect(out.snapshotProse.toLowerCase()).toContain(
      "no completed jobs"
    );
    expect(out.comparisons.completedVsTrailing.direction).toBe("flat");
    expect(out.citationManifest).toEqual([]);
  });

  it("LLM hallucinates a dollar figure → fail-closed", async () => {
    const llm: LlmCaller = vi.fn(
      async () => "Big week — $99999K of new revenue blew past baseline."
    );
    await expect(
      renderRevenueSnapshot(baseInputs, llm)
    ).rejects.toThrow(/uncited dollar figure/);
  });

  it("missing baseline values handled (zero-baseline = up if delta > 0)", async () => {
    const out = await renderRevenueSnapshot({
      ...baseInputs,
      priorWeekBaseline: {
        completedRevenue: 0,
        paidRevenue: 0,
        outstandingTotal: 0,
        avgTicket: 0,
      },
    });
    expect(out.comparisons.completedVsTrailing.direction).toBe("up");
  });
});

describe("maya-service-revenue-snapshot-renderer — cross-tenant", () => {
  it("Business B's jobs never appear in Business A's snapshot", async () => {
    const businessA = await renderRevenueSnapshot(baseInputs);
    const businessB = await renderRevenueSnapshot({
      ...baseInputs,
      crmJobs: [
        {
          id: "biz_b_only",
          customerLastName: "Other",
          serviceType: "X",
          completedAt: NOW - 1 * ONE_DAY,
          ticketAmount: 99999,
        },
      ],
      crmInvoices: [],
    });
    const aIds = businessA.citationManifest.map((c) => c.jobId);
    const bIds = businessB.citationManifest.map((c) => c.jobId);
    expect(aIds).not.toContain("biz_b_only");
    expect(bIds).toContain("biz_b_only");
  });
});

describe("maya-service-revenue-snapshot-renderer — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    await expect(renderRevenueSnapshot(baseInputs)).resolves.toBeDefined();
  });
});

describe("maya-service-revenue-snapshot-renderer — math helpers", () => {
  it("formatCurrency rounds to K above 1000", () => {
    expect(__test__.formatCurrency(14_200)).toBe("$14.2K");
    expect(__test__.formatCurrency(950)).toBe("$950");
  });

  it("direction respects 5% flat threshold", () => {
    expect(__test__.direction(40, 1000)).toBe("flat"); // 4%
    expect(__test__.direction(60, 1000)).toBe("up"); // 6%
    expect(__test__.direction(-100, 1000)).toBe("down"); // 10%
  });
});
