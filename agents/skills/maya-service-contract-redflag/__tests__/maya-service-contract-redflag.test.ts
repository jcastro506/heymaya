import { describe, it, expect, vi } from "vitest";
import {
  scanContractRedflags,
  SKILL_METADATA,
  type ContractRedflagInputs,
  type LlmCaller,
  type PdfExtractor,
} from "../script";

const SAMPLE_PDF: ContractRedflagInputs = {
  pdfBase64: "JVBERi0xLjQK",
  contractKind: "lead-gen",
  jurisdictionHint: "NE",
};

const goodPages = [
  {
    pageNumber: 1,
    text: "This Agreement automatically renews for successive 12-month terms unless terminated in writing 90 days prior to the renewal date. Vendor reserves all intellectual property rights including any derivative works produced during the engagement.",
  },
  {
    pageNumber: 2,
    text: "Operator agrees to indemnify Vendor against all claims, including those arising from third-party data. Payment net 60 days from invoice date.",
  },
];

describe("maya-service-contract-redflag — contract", () => {
  it("declares HIGH thinking + Pro+", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("high");
    expect(SKILL_METADATA.planTier).toEqual(["pro", "studio"]);
  });
});

describe("maya-service-contract-redflag — happy path", () => {
  it("flags auto-renew + ip-grant + indemnity (verbatim quotes)", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({ pages: goodPages }));
    const llm: LlmCaller = vi.fn(async () =>
      JSON.stringify({
        redFlags: [
          {
            category: "auto-renew",
            clauseText:
              "This Agreement automatically renews for successive 12-month terms unless terminated in writing 90 days prior to the renewal date.",
            pageRef: 1,
            severity: "high",
            explanation: "Auto-renew with 90-day prior notice — easy to miss.",
          },
          {
            category: "ip-grant",
            clauseText:
              "Vendor reserves all intellectual property rights including any derivative works produced during the engagement.",
            pageRef: 1,
            severity: "high",
            explanation: "Vendor owns derivative work — unusual for service contracts.",
          },
          {
            category: "indemnity",
            clauseText:
              "Operator agrees to indemnify Vendor against all claims, including those arising from third-party data.",
            pageRef: 2,
            severity: "high",
            explanation: "Open-ended indemnity — operator-side risk exposure.",
          },
        ],
      })
    );
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.parsedSuccessfully).toBe(true);
    expect(out.redFlags.length).toBe(3);
    expect(out.redFlags.map((f) => f.category)).toEqual([
      "auto-renew",
      "ip-grant",
      "indemnity",
    ]);
    expect(out.alwaysCloseLine).toMatch(/not legal advice/);
  });

  it("strips fabricated red flags whose clauseText isn't verbatim on the cited page", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({ pages: goodPages }));
    const llm: LlmCaller = vi.fn(async () =>
      JSON.stringify({
        redFlags: [
          {
            category: "kill-fee",
            clauseText: "Operator owes a $50,000 kill fee on early termination.", // not in pages
            pageRef: 1,
            severity: "high",
            explanation: "fabricated",
          },
        ],
      })
    );
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.redFlags.length).toBe(0);
    expect(out.parsedSuccessfully).toBe(true);
  });

  it("zero red flags returned for clean contract", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({
      pages: [{ pageNumber: 1, text: "Standard payment terms net 30." }],
    }));
    const llm: LlmCaller = vi.fn(async () => JSON.stringify({ redFlags: [] }));
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.redFlags).toEqual([]);
    expect(out.parsedSuccessfully).toBe(true);
  });
});

describe("maya-service-contract-redflag — adversarial PDFs", () => {
  it("malformed PDF: extractor throws → parsedSuccessfully=false", async () => {
    const extractor: PdfExtractor = vi.fn(async () => {
      throw new Error("invalid pdf");
    });
    const llm: LlmCaller = vi.fn();
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.parsedSuccessfully).toBe(false);
    expect(out.redFlags).toEqual([]);
    expect(llm).not.toHaveBeenCalled();
  });

  it("password-locked PDF: graceful flag + parsedSuccessfully=false", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({
      pages: [],
      isLocked: true,
    }));
    const llm: LlmCaller = vi.fn();
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.parsedSuccessfully).toBe(false);
    expect(out.redFlags[0].category).toBe("other");
    expect(out.redFlags[0].explanation).toMatch(/password-locked/);
    expect(llm).not.toHaveBeenCalled();
  });

  it("scan-only PDF (no text layer): graceful flag", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({
      pages: [
        { pageNumber: 1, text: "" },
        { pageNumber: 2, text: "" },
      ],
      isScanOnly: true,
    }));
    const llm: LlmCaller = vi.fn();
    const out = await scanContractRedflags(SAMPLE_PDF, extractor, llm);
    expect(out.parsedSuccessfully).toBe(false);
    expect(out.redFlags[0].explanation).toMatch(/scanned image/);
  });

  it("LLM returns non-JSON: throws", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({ pages: goodPages }));
    const llm: LlmCaller = vi.fn(async () => "I cannot help");
    await expect(
      scanContractRedflags(SAMPLE_PDF, extractor, llm)
    ).rejects.toThrow();
  });
});

describe("maya-service-contract-redflag — cross-tenant", () => {
  it("Business A's PDF text never appears in Business B's prompt", async () => {
    const calls: { system: string; user: string }[] = [];
    const llm: LlmCaller = vi.fn(async (p) => {
      calls.push(p);
      return JSON.stringify({ redFlags: [] });
    });
    const extractorA: PdfExtractor = vi.fn(async () => ({
      pages: [{ pageNumber: 1, text: "BUSINESS-A-SECRET-CLAUSE" }],
    }));
    const extractorB: PdfExtractor = vi.fn(async () => ({
      pages: [{ pageNumber: 1, text: "BUSINESS-B-NORMAL-CLAUSE" }],
    }));
    await scanContractRedflags(SAMPLE_PDF, extractorA, llm);
    await scanContractRedflags(SAMPLE_PDF, extractorB, llm);
    expect(calls[0].user).toContain("BUSINESS-A");
    expect(calls[0].user).not.toContain("BUSINESS-B");
    expect(calls[1].user).toContain("BUSINESS-B");
    expect(calls[1].user).not.toContain("BUSINESS-A");
  });
});

describe("maya-service-contract-redflag — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    const extractor: PdfExtractor = vi.fn(async () => ({ pages: goodPages }));
    const llm: LlmCaller = vi.fn(async () => JSON.stringify({ redFlags: [] }));
    await expect(
      scanContractRedflags(SAMPLE_PDF, extractor, llm)
    ).resolves.toBeDefined();
  });
});
