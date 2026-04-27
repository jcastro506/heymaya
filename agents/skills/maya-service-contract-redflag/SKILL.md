---
name: maya-service-contract-redflag
version: 0.1.0-sprint3
description: Scan an uploaded service contract / vendor agreement / supplier agreement PDF for red flags — auto-renew, IP grants, kill fees, exclusivity, payment terms, FTC compliance.
when-to-use: Event-driven on any PDF upload to the Deals or Documents surface; on-demand from chat ("Maya, look at this contract").
plan-tier: pro+.
model-routing: Gemini 3 Flash, HIGH thinking. Per § 3 routing matrix — real money / legal exposure.
---

# maya-service-contract-redflag

## Purpose

Operators sign a lot of contracts: supplier agreements, lead-gen vendor contracts, equipment-finance docs, franchise / sub-contract docs. Most have at least one red-flag clause buried in 20 pages. Maya doesn't replace a lawyer — she surfaces the things worth asking a lawyer about.

## Inputs

```ts
{
  pdfBase64: string;                     // raw PDF bytes
  contractKind?: "supplier" | "lead-gen" | "equipment-finance" | "franchise" | "subcontract" | "other";
  jurisdictionHint?: string;             // operator's state for state-specific flags
}
```

## Outputs

```ts
{
  redFlags: Array<{
    category: "auto-renew" | "ip-grant" | "kill-fee" | "exclusivity" | "payment-terms" | "term-length" | "indemnity" | "termination" | "ftc-compliance" | "other";
    clauseText: string;                  // verbatim quote
    pageRef: number;
    severity: "high" | "medium" | "low";
    explanation: string;                 // why this is a flag in plain language
  }>;
  parsedSuccessfully: boolean;
  pageCount: number;
  alwaysCloseLine: "this is a flag, not legal advice — get a lawyer if anything feels off";
}
```

## Plan-tier

Pro and Studio.

## Test categories

- Adversarial PDF: malformed, password-locked, scan-only (no OCR text). All produce `parsedSuccessfully: false` + a graceful operator-facing message.
- Cross-tenant: Business A's contract never appears in Business B's redFlags output.
- Citation: every red flag includes a `clauseText` quote + `pageRef` — never invented.

## Sibling files

Calls: Anthropic public `pdf` skill (parsing). No Convex writes from this skill — the orchestrator persists to `dealContracts`.
