/**
 * `makeVendorContract` — produces a synthetic vendor agreement (markdown)
 * with 3-4 realistic red-flag clauses embedded.
 *
 * Why markdown not PDF: the project does NOT depend on `pdfkit` or any PDF
 * lib (verified `package.json`); shipping markdown keeps the corpus
 * dependency-free. The Sprint 3 `contract-redflag` skill ingests text
 * either way — Sprint 3 will add a small markdown→text trampoline if the
 * skill expects PDF.
 *
 * The corpus dumps each contract to `data/<slug>/contract.md` for operator
 * inspection. The `FixtureVendorContract.embeddedRedFlags` array enumerates
 * which red flags were embedded — the skill's test harness asserts >= the
 * embedded set is detected.
 */

import { ALL_RED_FLAGS, RED_FLAG_CLAUSES, type ServiceType, type RedFlagId } from "./data";
import type { FixtureVendorContract } from "../types";
import type { Rng } from "./rng";

const NOW = 1_700_000_000_000;

interface MakeContractInput {
  operatorName: string;
  operatorAddress: string;
  serviceType: ServiceType;
}

const VENDOR_KIND_BY_SERVICE: Record<ServiceType, string> = {
  hvac: "HVAC equipment supply",
  plumbing: "plumbing supply + co-op marketing",
  electrical: "lighting fixture wholesale",
  landscaping: "landscape supply + lead-gen",
  cleaning: "janitorial supply + uniform service",
  roofing: "roofing material wholesale + lead-gen",
  "pest-control": "chemical supply + lead-gen",
  restoration: "equipment rental + insurance referral",
  contracting: "lumber + lead-gen",
  "mobile-detailing": "wholesale supply + branded apparel",
};

export function makeVendorContract(
  rng: Rng,
  input: MakeContractInput
): FixtureVendorContract {
  const { operatorName, operatorAddress, serviceType } = input;
  const vendorSurname = rng.pick([
    "Apex",
    "Capstone",
    "Cornerstone",
    "Pinnacle",
    "Vanguard",
    "Summit",
    "Cascade",
    "Mainline",
    "Beacon",
    "Lighthouse",
  ]);
  const vendorName = `${vendorSurname} ${VENDOR_KIND_BY_SERVICE[serviceType].split(" ")[0]} LLC`;
  const effectiveDate = new Date(NOW).toISOString().slice(0, 10);

  // Embed 3-4 red flags, deterministically chosen from the pool.
  const redFlagCount = rng.int(3, 4);
  const embeddedRedFlags = rng.sample(
    ALL_RED_FLAGS as unknown as RedFlagId[],
    redFlagCount
  );

  const body = `# Vendor Services Agreement

**Effective Date:** ${effectiveDate}
**Vendor:** ${vendorName} ("Vendor")
**Operator:** ${operatorName} ("Operator")
**Operator Address of Record:** ${operatorAddress}

This Vendor Services Agreement (this "Agreement") is entered into by and
between the parties identified above and governs the provision of
${VENDOR_KIND_BY_SERVICE[serviceType]} services by Vendor to Operator.

## 1. Services
Vendor shall provide the services described in Schedule A attached hereto.
Vendor shall perform the Services in accordance with industry standards
and applicable law.

## 2. Compensation
Operator shall pay Vendor the fees set forth in Schedule B in accordance
with the payment schedule. Late payments shall accrue interest at 1.5%
per month or the maximum rate permitted by law, whichever is lower.

## 3. Confidentiality
Each party shall hold the Confidential Information of the other in
confidence and shall not disclose it to any third party except as
expressly permitted herein.

## 4. Representations & Warranties
Vendor represents that it has the authority to enter into this Agreement
and that the Services will be performed in a workmanlike manner.

${embeddedRedFlags.map((id) => RED_FLAG_CLAUSES[id]).join("\n\n")}

## 99. General
This Agreement constitutes the entire agreement between the parties and
supersedes all prior negotiations, representations, or agreements relating
to its subject matter. This Agreement shall be governed by the laws of the
State of [Operator's home state]. Any amendment must be in writing signed
by both parties (subject to Section 17 if included).

---

**OPERATOR**

By: __________________________________
Name: ${operatorName}
Title: Owner
Date: ____________________

**VENDOR**

By: __________________________________
Name: [Authorized Signatory]
Title: [Title]
Date: ____________________
`;

  return {
    filename: "contract.md",
    vendorName,
    body,
    embeddedRedFlags,
  };
}
