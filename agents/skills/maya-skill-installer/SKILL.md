---
name: maya-skill-installer
version: 0.1.0-sprint3.5
status: NOT-SHIPPED-IN-V0 (operator decision 2026-04-27 fourth correction)
description: DEV-TIME REFERENCE ONLY. This was originally designed as a runtime meta-skill that Maya would invoke when she hit a capability gap mid-task — search ClawHub + skills.sh, present candidates, install on operator approval. Reversed by operator 2026-04-27: every Maya gets the same curated skill bundle at deploy time; no runtime skill installation; no per-business skill divergence. Kept in-repo as a reference shape we may use as our own dev-time curation tool when picking ClawHub baseline skills.
when-to-use: NOT INVOKED IN V0. The runtime extension surface is retired. If reintroduced post-MVP (Phase 1.5+), it would gate behind explicit operator opt-in + the security gates documented below. For v0, the curated baseline ships uniformly with every Maya — no operator-approved on-demand installs.
plan-tier: not-applicable-v0 (Phase 1.5+ would be Pro+ only).
model-routing: not-applicable-v0.
metadata:
  openclaw:
    requires:
      env: []
    tags:
      - skill-installer
      - dev-time-only
      - not-shipped-v0
      - creator
---

# maya-skill-installer (NOT SHIPPED IN V0)

> **2026-04-27 status:** This SKILL.md is preserved in-repo for reference but **does NOT ship in any v0 Maya's workspace bundle**. Per operator (fourth correction this day): every Maya gets the same curated skill bundle at deploy time; no runtime skill installation; no per-business skill divergence; no operator-approved on-demand install surface. The `customSkills` schema table is similarly retired in v0 (kept additive; never populated). The HQ Profile "Skills tab" planned for Sprint 5 is dropped.
>
> **What stays useful from this design:** the *capability shape* (search ClawHub, evaluate candidates, risk-flag, version-pin) is a sound dev-time curation tool **we** could use when picking the v0 baseline ClawHub skills (NemoVideo for video, etc.). It's just not a runtime surface Maya invokes.

---

## Purpose (HISTORICAL — Sprint 3.5 design, NOT v0)

Maya's curated baseline is 15 service-skills + 4 Anthropic public skills. Service businesses are too varied to predict every niche skill in advance — a roofer might need drone-photogrammetry; a cleaner might need recurring-customer cadence; a restoration contractor might need FEMA-claim documentation. This skill *was originally designed* to let Maya extend herself with ClawHub or skills.sh community skills, **gated by operator approval at every install**.

**v0 policy (post-correction 2026-04-27):** every Maya gets the SAME bundle. No runtime extension. The variation surface in v0 is `soul.md` + memory-wiki seeds + connected accounts only.

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
