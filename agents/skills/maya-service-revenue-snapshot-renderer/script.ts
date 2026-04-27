/**
 * maya-service-revenue-snapshot-renderer — CRM data → 80-150 word prose snapshot.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, HIGH thinking — high-stakes,
 * multi-document grounding. Math is deterministic; the LLM call is for prose
 * composition only. Numbers are computed pre-LLM and passed in via the prompt;
 * citation firewall enforces preservation post-LLM.
 *
 * Anti-fake-busy: if no significant change vs baseline, the prose is short
 * ("steady week — 18 jobs, $14.2K, on pace") and `comparisons` flags zeroes.
 */

export interface RevenueSnapshotInputs {
  crmJobs: ReadonlyArray<{
    id: string;
    customerLastName: string;
    serviceType: string;
    completedAt: number;
    ticketAmount: number;
  }>;
  crmInvoices: ReadonlyArray<{
    id: string;
    jobId: string;
    amount: number;
    paidAt: number | null;
    issuedAt: number;
  }>;
  priorWeekBaseline: {
    completedRevenue: number;
    paidRevenue: number;
    outstandingTotal: number;
    avgTicket: number;
  };
  windowStart: number;
  windowEnd: number;
}

export interface RevenueSnapshotOutput {
  snapshotProse: string;
  comparisons: {
    completedVsTrailing: {
      delta: number;
      direction: "up" | "down" | "flat";
    };
    paidVsTrailing: {
      delta: number;
      direction: "up" | "down" | "flat";
    };
    outstandingFlag: boolean;
  };
  citationManifest: ReadonlyArray<{ jobId: string; invoiceId?: string }>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const FLAT_THRESHOLD_PCT = 0.05; // <5% change = "flat"
const AGED_INVOICE_DAYS = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function direction(delta: number, baseline: number): "up" | "down" | "flat" {
  if (baseline === 0) return delta > 0 ? "up" : "flat";
  const pct = Math.abs(delta) / baseline;
  if (pct < FLAT_THRESHOLD_PCT) return "flat";
  return delta > 0 ? "up" : "down";
}

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}K`;
  }
  return `$${n.toFixed(0)}`;
}

function computeMetrics(
  inputs: RevenueSnapshotInputs
): {
  jobsInWindow: typeof inputs.crmJobs;
  completedRevenue: number;
  paidRevenue: number;
  outstandingTotal: number;
  outstandingAgedTotal: number;
  agedInvoiceCount: number;
  avgTicket: number;
} {
  const jobsInWindow = inputs.crmJobs.filter(
    (j) => j.completedAt >= inputs.windowStart && j.completedAt <= inputs.windowEnd
  );
  const completedRevenue = jobsInWindow.reduce(
    (s, j) => s + j.ticketAmount,
    0
  );
  const jobIdSet = new Set(jobsInWindow.map((j) => j.id));
  const invoicesForWindow = inputs.crmInvoices.filter((i) =>
    jobIdSet.has(i.jobId)
  );
  const paidRevenue = invoicesForWindow
    .filter((i) => i.paidAt !== null)
    .reduce((s, i) => s + i.amount, 0);
  const outstandingTotal = invoicesForWindow
    .filter((i) => i.paidAt === null)
    .reduce((s, i) => s + i.amount, 0);

  const ageThreshold = inputs.windowEnd - AGED_INVOICE_DAYS * MS_PER_DAY;
  const agedInvoices = invoicesForWindow.filter(
    (i) => i.paidAt === null && i.issuedAt < ageThreshold
  );
  const outstandingAgedTotal = agedInvoices.reduce(
    (s, i) => s + i.amount,
    0
  );
  const avgTicket =
    jobsInWindow.length > 0 ? completedRevenue / jobsInWindow.length : 0;

  return {
    jobsInWindow,
    completedRevenue,
    paidRevenue,
    outstandingTotal,
    outstandingAgedTotal,
    agedInvoiceCount: agedInvoices.length,
    avgTicket,
  };
}

function buildPrompt(
  metrics: ReturnType<typeof computeMetrics>,
  baseline: RevenueSnapshotInputs["priorWeekBaseline"],
  comparisons: RevenueSnapshotOutput["comparisons"]
): { system: string; user: string } {
  const system = [
    "You write a 80-150 word weekly revenue snapshot for a service-business operator.",
    "",
    "HARD RULES:",
    "1. Use ONLY the numbers provided below. Do not invent or round to different values.",
    "2. Anti-fake-busy: if every direction is 'flat', return one short sentence (e.g. 'Steady week — 18 jobs, $14.2K, on pace.').",
    "3. If completed jobs == 0, return 'No completed jobs this window' + skip comparisons.",
    "4. If outstandingFlag is true, mention it explicitly — operator cares about aged AR.",
    "5. Plain prose only. No markdown, no headers.",
  ].join("\n");

  const lines = [
    `Window: ${new Date(metrics.jobsInWindow[0]?.completedAt ?? 0).toISOString().slice(0, 10)}-period`,
    `Completed jobs: ${metrics.jobsInWindow.length}`,
    `Completed revenue: ${formatCurrency(metrics.completedRevenue)}`,
    `Paid revenue: ${formatCurrency(metrics.paidRevenue)}`,
    `Outstanding total: ${formatCurrency(metrics.outstandingTotal)}`,
    `Avg ticket: ${formatCurrency(metrics.avgTicket)}`,
    `Aged (>${AGED_INVOICE_DAYS}d) outstanding: ${formatCurrency(metrics.outstandingAgedTotal)} across ${metrics.agedInvoiceCount} invoices`,
    `Trailing baseline — completed: ${formatCurrency(baseline.completedRevenue)}, paid: ${formatCurrency(baseline.paidRevenue)}, avg ticket: ${formatCurrency(baseline.avgTicket)}`,
    `Direction — completed: ${comparisons.completedVsTrailing.direction} (${comparisons.completedVsTrailing.delta > 0 ? "+" : ""}${comparisons.completedVsTrailing.delta.toFixed(0)})`,
    `Direction — paid: ${comparisons.paidVsTrailing.direction}`,
    `outstandingFlag: ${comparisons.outstandingFlag}`,
  ].join("\n");

  return { system, user: lines };
}

export async function renderRevenueSnapshot(
  inputs: RevenueSnapshotInputs,
  callLlm?: LlmCaller
): Promise<RevenueSnapshotOutput> {
  const metrics = computeMetrics(inputs);

  const completedDelta =
    metrics.completedRevenue - inputs.priorWeekBaseline.completedRevenue;
  const paidDelta = metrics.paidRevenue - inputs.priorWeekBaseline.paidRevenue;

  const comparisons: RevenueSnapshotOutput["comparisons"] = {
    completedVsTrailing: {
      delta: completedDelta,
      direction: direction(
        completedDelta,
        inputs.priorWeekBaseline.completedRevenue
      ),
    },
    paidVsTrailing: {
      delta: paidDelta,
      direction: direction(paidDelta, inputs.priorWeekBaseline.paidRevenue),
    },
    outstandingFlag: metrics.agedInvoiceCount > 0,
  };

  const citationManifest: { jobId: string; invoiceId?: string }[] =
    metrics.jobsInWindow.map((j) => {
      const inv = inputs.crmInvoices.find((i) => i.jobId === j.id);
      return inv ? { jobId: j.id, invoiceId: inv.id } : { jobId: j.id };
    });

  // Empty-window short-circuit (no LLM call needed).
  if (metrics.jobsInWindow.length === 0) {
    return {
      snapshotProse:
        "No completed jobs in this window — nothing to recap on the revenue side.",
      comparisons: {
        completedVsTrailing: { delta: 0, direction: "flat" },
        paidVsTrailing: { delta: 0, direction: "flat" },
        outstandingFlag: false,
      },
      citationManifest: [],
    };
  }

  let snapshotProse: string;
  if (callLlm) {
    const prompt = buildPrompt(metrics, inputs.priorWeekBaseline, comparisons);
    const raw = (await callLlm(prompt)).trim();
    if (raw.length === 0) {
      snapshotProse = fallbackProse(metrics, comparisons);
    } else {
      snapshotProse = raw;
    }
  } else {
    snapshotProse = fallbackProse(metrics, comparisons);
  }

  // Citation firewall: every dollar figure in the prose must have come from
  // metrics. We check that any $-figure in prose appears in our computed set.
  const proseDollars = (snapshotProse.match(/\$\d[\d,.]*K?/g) ?? []).map(
    (s) => s.toLowerCase()
  );
  const allowedDollars = new Set<string>([
    formatCurrency(metrics.completedRevenue).toLowerCase(),
    formatCurrency(metrics.paidRevenue).toLowerCase(),
    formatCurrency(metrics.outstandingTotal).toLowerCase(),
    formatCurrency(metrics.avgTicket).toLowerCase(),
    formatCurrency(metrics.outstandingAgedTotal).toLowerCase(),
    formatCurrency(inputs.priorWeekBaseline.completedRevenue).toLowerCase(),
    formatCurrency(inputs.priorWeekBaseline.paidRevenue).toLowerCase(),
    formatCurrency(inputs.priorWeekBaseline.avgTicket).toLowerCase(),
  ]);
  for (const d of proseDollars) {
    if (!allowedDollars.has(d)) {
      throw new Error(
        `revenue-snapshot: prose mentions uncited dollar figure '${d}'`
      );
    }
  }

  return { snapshotProse, comparisons, citationManifest };
}

function fallbackProse(
  metrics: ReturnType<typeof computeMetrics>,
  comparisons: RevenueSnapshotOutput["comparisons"]
): string {
  const allFlat =
    comparisons.completedVsTrailing.direction === "flat" &&
    comparisons.paidVsTrailing.direction === "flat";
  if (allFlat) {
    return `Steady week — ${metrics.jobsInWindow.length} jobs, ${formatCurrency(metrics.completedRevenue)}, on pace.`;
  }
  const parts: string[] = [];
  parts.push(
    `${metrics.jobsInWindow.length} completed jobs, ${formatCurrency(metrics.completedRevenue)} completed revenue, ${formatCurrency(metrics.paidRevenue)} paid, ${formatCurrency(metrics.outstandingTotal)} outstanding.`
  );
  if (comparisons.completedVsTrailing.direction !== "flat") {
    parts.push(
      `Completed revenue is ${comparisons.completedVsTrailing.direction} vs the prior baseline.`
    );
  }
  if (comparisons.outstandingFlag) {
    parts.push(
      `${metrics.agedInvoiceCount} invoice(s) are over ${AGED_INVOICE_DAYS} days outstanding — worth a follow-up.`
    );
  }
  return parts.join(" ");
}

export const SKILL_METADATA = {
  name: "maya-service-revenue-snapshot-renderer" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "high" as const,
  planTier: ["pro", "studio"] as const,
  /** CRM connection required for this skill to run. */
  requiresCrm: true as const,
};

export const __test__ = { computeMetrics, buildPrompt, formatCurrency, direction };
