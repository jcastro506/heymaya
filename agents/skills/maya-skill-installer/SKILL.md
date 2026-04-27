---
name: maya-skill-installer
version: 0.1.0-sprint3.5
description: Meta-skill — when Maya identifies a capability gap during her work, search ClawHub + skills.sh for relevant skills, present top candidates to the operator with risk flags + permissions list, install on operator approval.
when-to-use: When Maya hits a capability gap mid-task (e.g. "I want to extract structured data from this drone-footage operator's job photos but I don't have a drone-photogrammetry skill"). Pro+ only — Starter has the curated § 7 baseline + nothing else.
plan-tier: pro+ (Pro and Studio).
model-routing: Gemini 3 Flash, MEDIUM thinking. Per § 8.5 — search ranking + risk-flag classification benefit from medium reasoning.
---

# maya-skill-installer

## Purpose (per plan § 8.5)

Maya's curated baseline is 15 service-skills + 4 Anthropic public skills. Service businesses are too varied to predict every niche skill in advance — a roofer might need drone-photogrammetry; a cleaner might need recurring-customer cadence; a restoration contractor might need FEMA-claim documentation. This skill lets Maya extend herself with ClawHub or skills.sh community skills, **gated by operator approval at every install**.

This is a **deliberate v0 policy reversal** for the service product (creator-side keeps the no-third-party-skills posture). The curated baseline stays Anthropic + custom-Maya only; the extension path is gated through this meta-skill with a Pro+ opt-in toggle (default OFF on first Pro upgrade).

## Inputs

```ts
{
  capabilityDescription: string;         // free-form, e.g. "extract structured data from drone-footage job photos"
  preferredRegistry: "clawhub" | "skills.sh" | "both";
  verifiedOnly?: boolean;                // default true; flipping to false surfaces a red warning
  searchContext?: string;                // optional Maya task that triggered the search
  businessId: string;
  operatorUserId: string;                // for audit log
}
```

## Outputs

```ts
{
  candidates: Array<{                    // top 5 ranked
    name: string;
    sourceUrl: string;
    author: string;
    installCount?: number;
    verified: boolean;                   // registry's verified flag at search time
    requestedPermissions: string[];      // tool surface the skill claims it needs
    riskFlags: Array<                    // pre-presentation rejection happens BEFORE this list
      "unverified" | "high-permission-count" | "recently-published" | "low-install-count" | "permission-creep"
    >;
    description: string;
  }>;
  blockedCandidates: Array<{             // candidates rejected pre-presentation
    name: string;
    sourceUrl: string;
    blockedReason: "unknown-permission" | "raw-fs-write" | "arbitrary-http" | "rejected-by-allowlist";
  }>;
  approvalLink: string;                  // operator approval URL — install requires explicit click
  searchAuditId: string;                 // entry in audit log for this search
}
```

## Security gates (per § 8.5 — all required)

1. **Operator approval required for every install — never silent.** The `approvalLink` returns to a Convex action that requires the operator to confirm in the dashboard. Maya cannot install without operator click.
2. **`verifiedOnly: true` is the default.** Flipping to `false` surfaces a red warning in the operator UI; the search still runs but the candidates carry `verified: false` flag prominently.
3. **Curated allow-list of permissible tool requests.** A candidate skill requesting an unknown / excessive tool surface (e.g. `raw-fs-write`, arbitrary HTTP) is rejected pre-presentation — added to `blockedCandidates`, never shown to operator. The allowlist lives in `convex/lib/skillInstallerAllowlist.ts` (Sprint 3.5).
4. **Version-pinned per business.** Installed skills never auto-upgrade; operator approves each version bump. Pinning lives in the `customSkills` table (§ 8.5 schema).
5. **Convex audit log.** Every search + install + uninstall logged with `operatorUserId` + `searchAuditId`. Operator can review the full log per-business in HQ → Profile → Skills.

## Plan-tier

Pro and Studio. Starter cannot call this skill — Convex action fails closed at entry.

## Test categories (per § 8.5)

1. **Cross-tenant** — Business A's installed skills never visible in Business B's runtime.
2. **Plan-tier** — Starter blocked at the search-call entry. Server-side fail-closed.
3. **Adversarial** — malicious manifest rejected (raw-fs-write request); permission-creep skill (claims minimal then needs more on first run) rejected; operator-approval bypass attempt (forged `approvalLink` payload) rejected.
4. **Idempotency** — re-install of same skill+version is a no-op + audit-logged.
5. **Audit completeness** — every search, install, uninstall has a row in `customSkills` audit log.

## Sibling files

Schema additions: `customSkills` table (§ 8.5). Allowlist: `convex/lib/skillInstallerAllowlist.ts` (Sprint 3.5). UI: HQ → Profile → Skills tab (Sprint 5).

## Operator-facing copy (locked language)

UI surfaces this exact warning when a community-skill install is proposed:

> "Pro+ feature: Maya can install community skills with your approval. Community skills are reviewed but not Anthropic-built. Installing a skill grants it the listed tool permissions on your business data. We log every install + give you per-skill audit trails. You can uninstall at any time."

The operator MUST click "approve [skill name] vX.Y" before any install proceeds. Default-OFF on first Pro upgrade — operator turns the meta-skill on explicitly.
