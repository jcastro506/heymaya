/**
 * maya-service-contract-redflag — PDF contract red-flag scanner.
 *
 * Per § 3 routing matrix: Gemini 3 Flash, HIGH thinking — real money / legal
 * exposure. The skill takes raw PDF bytes (base64), extracts page text via
 * an injected `pdfExtractor` (Anthropic public `pdf` skill at runtime), and
 * asks the LLM to surface red-flag clauses with verbatim quotes + page refs.
 *
 * Adversarial PDFs are handled at the extractor boundary:
 *   - malformed bytes → extractor throws → we return parsedSuccessfully:false
 *   - password-locked → extractor returns isLocked:true → graceful message
 *   - scan-only (no text layer) → extractor returns pages with empty text →
 *     graceful "scanned PDF detected — operator action required"
 *
 * The skill itself never persists; the orchestrator writes findings to
 * `dealContracts` (see § 8 schema).
 */

export type ContractKind =
  | "supplier"
  | "lead-gen"
  | "equipment-finance"
  | "franchise"
  | "subcontract"
  | "other";

export type RedFlagCategory =
  | "auto-renew"
  | "ip-grant"
  | "kill-fee"
  | "exclusivity"
  | "payment-terms"
  | "term-length"
  | "indemnity"
  | "termination"
  | "ftc-compliance"
  | "other";

export interface ContractRedflagInputs {
  pdfBase64: string;
  contractKind?: ContractKind;
  jurisdictionHint?: string;
}

export interface ContractRedflagOutput {
  redFlags: ReadonlyArray<{
    category: RedFlagCategory;
    clauseText: string;
    pageRef: number;
    severity: "high" | "medium" | "low";
    explanation: string;
  }>;
  parsedSuccessfully: boolean;
  pageCount: number;
  alwaysCloseLine: "this is a flag, not legal advice — get a lawyer if anything feels off";
}

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractResult {
  pages: PdfPage[];
  isLocked?: boolean;
  isScanOnly?: boolean;
  errorMessage?: string;
}

export interface PdfExtractor {
  (pdfBase64: string): Promise<PdfExtractResult>;
}

export interface LlmCaller {
  (prompt: { system: string; user: string }): Promise<string>;
}

const VALID_CATEGORIES: ReadonlySet<RedFlagCategory> = new Set([
  "auto-renew",
  "ip-grant",
  "kill-fee",
  "exclusivity",
  "payment-terms",
  "term-length",
  "indemnity",
  "termination",
  "ftc-compliance",
  "other",
]);

const ALWAYS_CLOSE_LINE =
  "this is a flag, not legal advice — get a lawyer if anything feels off" as const;

function buildPrompt(
  pages: PdfPage[],
  contractKind?: ContractKind,
  jurisdictionHint?: string
): { system: string; user: string } {
  const system = [
    "You scan a service-business contract for red-flag clauses. You are NOT a lawyer.",
    "",
    "Red-flag categories (use exactly these strings):",
    "auto-renew | ip-grant | kill-fee | exclusivity | payment-terms | term-length | indemnity | termination | ftc-compliance | other",
    "",
    "HARD RULES:",
    "1. clauseText must be a VERBATIM quote from the contract — never paraphrase, never invent.",
    "2. pageRef must match the page the verbatim quote appears on.",
    "3. severity: 'high' = active legal/financial exposure, 'medium' = significant operator burden, 'low' = note-worthy but not urgent.",
    "4. explanation: plain English (1-2 sentences) — why this flag matters to a service operator.",
    "5. If a contract has NO red flags, return an empty redFlags array — do not invent flags.",
    "6. Output ONLY a JSON object — no markdown, no preamble.",
    "",
    "JSON output schema:",
    `{"redFlags": [{"category": string, "clauseText": string, "pageRef": number, "severity": "high"|"medium"|"low", "explanation": string}]}`,
  ].join("\n");

  const ctxLines = [
    contractKind ? `Contract kind: ${contractKind}` : null,
    jurisdictionHint ? `Operator jurisdiction: ${jurisdictionHint}` : null,
  ].filter((s): s is string => s !== null);

  const pagesBlock = pages
    .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}`)
    .join("\n\n");

  const user = [
    ...ctxLines,
    "",
    "Contract text by page:",
    pagesBlock,
    "",
    "Return the JSON object now.",
  ].join("\n");

  return { system, user };
}

interface RawRedFlag {
  category?: string;
  clauseText?: string;
  pageRef?: number;
  severity?: string;
  explanation?: string;
}

function parseLlmOutput(raw: string): RawRedFlag[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error("contract-redflag: LLM returned non-JSON");
    }
    parsed = JSON.parse(m[0]);
  }
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.redFlags) ? (obj.redFlags as RawRedFlag[]) : [];
}

function normalizeSeverity(s: string | undefined): "high" | "medium" | "low" {
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}

function normalizeCategory(c: string | undefined): RedFlagCategory {
  if (c && VALID_CATEGORIES.has(c as RedFlagCategory)) {
    return c as RedFlagCategory;
  }
  return "other";
}

export async function scanContractRedflags(
  inputs: ContractRedflagInputs,
  pdfExtractor: PdfExtractor,
  callLlm: LlmCaller
): Promise<ContractRedflagOutput> {
  let extracted: PdfExtractResult;
  try {
    extracted = await pdfExtractor(inputs.pdfBase64);
  } catch (err) {
    return {
      redFlags: [],
      parsedSuccessfully: false,
      pageCount: 0,
      alwaysCloseLine: ALWAYS_CLOSE_LINE,
    };
  }

  if (extracted.isLocked) {
    return {
      redFlags: [
        {
          category: "other",
          clauseText: "[contract is password-protected]",
          pageRef: 0,
          severity: "medium",
          explanation:
            "The PDF is password-locked and cannot be scanned. Unlock it and re-upload.",
        },
      ],
      parsedSuccessfully: false,
      pageCount: extracted.pages.length,
      alwaysCloseLine: ALWAYS_CLOSE_LINE,
    };
  }

  if (extracted.isScanOnly || extracted.pages.every((p) => p.text.trim().length === 0)) {
    return {
      redFlags: [
        {
          category: "other",
          clauseText: "[scanned image PDF — no extractable text]",
          pageRef: 0,
          severity: "medium",
          explanation:
            "This appears to be a scanned image PDF with no text layer. Run OCR before re-uploading or share the original digital file.",
        },
      ],
      parsedSuccessfully: false,
      pageCount: extracted.pages.length,
      alwaysCloseLine: ALWAYS_CLOSE_LINE,
    };
  }

  const prompt = buildPrompt(
    extracted.pages,
    inputs.contractKind,
    inputs.jurisdictionHint
  );
  const raw = await callLlm(prompt);
  const rawFlags = parseLlmOutput(raw);

  // Citation enforcement: every clauseText must be a verbatim substring of
  // the page identified by pageRef. Drop any flag that doesn't ground.
  const pageMap = new Map<number, string>(
    extracted.pages.map((p) => [p.pageNumber, p.text])
  );

  const redFlags: {
    category: RedFlagCategory;
    clauseText: string;
    pageRef: number;
    severity: "high" | "medium" | "low";
    explanation: string;
  }[] = [];
  for (const f of rawFlags) {
    const clauseText = typeof f.clauseText === "string" ? f.clauseText.trim() : "";
    const pageRef = typeof f.pageRef === "number" ? f.pageRef : -1;
    const pageText = pageMap.get(pageRef);
    if (!clauseText || !pageText) continue;
    // Verbatim check: collapse whitespace before comparing.
    const normPage = pageText.replace(/\s+/g, " ");
    const normClause = clauseText.replace(/\s+/g, " ");
    if (!normPage.includes(normClause)) continue;
    redFlags.push({
      category: normalizeCategory(f.category),
      clauseText,
      pageRef,
      severity: normalizeSeverity(f.severity),
      explanation:
        typeof f.explanation === "string" && f.explanation.trim().length > 0
          ? f.explanation
          : "Worth review — verbatim clause flagged for operator attention.",
    });
  }

  return {
    redFlags,
    parsedSuccessfully: true,
    pageCount: extracted.pages.length,
    alwaysCloseLine: ALWAYS_CLOSE_LINE,
  };
}

export const SKILL_METADATA = {
  name: "maya-service-contract-redflag" as const,
  modelTarget: "gemini-3-flash" as const,
  thinkingBudget: "high" as const,
  planTier: ["pro", "studio"] as const,
};

export const __test__ = { buildPrompt, parseLlmOutput };
