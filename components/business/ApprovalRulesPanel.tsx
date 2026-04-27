/**
 * "Trust Maya" approval-rules panel for the Profile screen.
 *
 * Per Service Sprint Plan § 13 Sprint 5 + § 12.6:
 *   - Starter: read-only "all actions require approval" notice
 *   - Pro:     toggles for review-request-auto-send + gbp-post-auto-publish
 *   - Studio:  adds content-rejuvenation-auto-publish
 *
 * CRITICAL: review-reply-auto-publish-allowlist is FORBIDDEN at every tier
 * — Google ReviewReplyState moderation lock. The UI shows it as a hard-
 * disabled row with an explanation, never a toggle.
 *
 * Server-side enforcement lives in `convex/planService.approvalRuleEnableable`.
 * This UI mirrors but never replaces that gate.
 */

import type { Doc } from "@/convex/_generated/dataModel";
import { Lock, ShieldCheck } from "lucide-react";

type RuleType =
  | "review-request-auto-send"
  | "gbp-post-auto-publish"
  | "review-reply-auto-publish-allowlist"
  | "content-rejuvenation-auto-publish";

const RULE_LABELS: Record<RuleType, { title: string; body: string }> = {
  "review-request-auto-send": {
    title: "Auto-send review requests",
    body: "When a job is marked complete, Maya texts the customer for a review without waiting for your tap. Honors your delay setting.",
  },
  "gbp-post-auto-publish": {
    title: "Auto-publish GBP posts",
    body: "Maya publishes drafted GBP local posts on the schedule you set. Photos still come from your library — Maya never invents.",
  },
  "review-reply-auto-publish-allowlist": {
    title: "Auto-reply to reviews (forbidden)",
    body: "Google requires a human to approve every review reply. This rule cannot be enabled at any plan tier.",
  },
  "content-rejuvenation-auto-publish": {
    title: "Auto-publish library rejuvenations",
    body: "Maya picks an unposted asset from your library and publishes a fresh GBP post on the cadence you set.",
  },
};

const ALL_RULE_TYPES: RuleType[] = [
  "review-request-auto-send",
  "gbp-post-auto-publish",
  "content-rejuvenation-auto-publish",
  "review-reply-auto-publish-allowlist",
];

export interface ApprovalRulesPanelProps {
  rules: Doc<"approvalRules">[];
  enableable: ReadonlyArray<string>;
  forbiddenAtAllTiers: ReadonlyArray<string>;
  plan: "starter" | "pro" | "studio";
  onToggle?: (ruleType: RuleType, nextEnabled: boolean) => void;
  testId?: string;
}

export function ApprovalRulesPanel({
  rules,
  enableable,
  forbiddenAtAllTiers,
  plan,
  onToggle,
  testId,
}: ApprovalRulesPanelProps) {
  const ruleByType = new Map<RuleType, Doc<"approvalRules">>();
  for (const r of rules) {
    ruleByType.set(r.ruleType as RuleType, r);
  }

  return (
    <section
      data-testid={testId ?? "biz-approval-rules-panel"}
      data-plan={plan}
      className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-5"
    >
      <header className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-lime" aria-hidden />
        <h3 className="font-display text-lg text-paper">Trust Maya</h3>
        <span className="ml-auto rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-faint">
          {plan} tier
        </span>
      </header>

      {plan === "starter" && (
        <p className="mb-4 rounded-xl border border-[var(--hairline)] bg-ink-3/60 p-3 text-sm text-paper-dim">
          On Starter, every Maya action is operator-approved. Upgrade to Pro
          to enable specific automations like review-request auto-send.
        </p>
      )}

      <ul className="space-y-3">
        {ALL_RULE_TYPES.map((rt) => {
          const isForbidden = forbiddenAtAllTiers.includes(rt);
          const isAllowed = enableable.includes(rt);
          const existing = ruleByType.get(rt);
          const enabled = existing?.enabled ?? false;
          const labels = RULE_LABELS[rt];
          const locked = isForbidden || !isAllowed;

          return (
            <li
              key={rt}
              data-testid={`biz-approval-rule-${rt}`}
              data-locked={locked ? "true" : "false"}
              data-forbidden={isForbidden ? "true" : "false"}
              className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
                locked
                  ? "border-[var(--hairline)] bg-ink-3/30 opacity-70"
                  : "border-[var(--hairline-strong)] bg-ink-3/60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-paper">
                  {labels.title}
                  {isForbidden && <Lock className="h-3 w-3 text-rose-300" aria-hidden />}
                </div>
                <p className="mt-1 text-xs text-paper-faint">{labels.body}</p>
                {!isAllowed && !isForbidden && (
                  <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-wider text-amber-200">
                    Upgrade to {plan === "starter" ? "Pro" : "Studio"} to
                    enable
                  </span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-disabled={locked}
                disabled={locked}
                data-testid={`biz-approval-rule-toggle-${rt}`}
                onClick={() => !locked && onToggle?.(rt, !enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  enabled && !locked
                    ? "bg-lime"
                    : locked
                    ? "bg-ink-3"
                    : "bg-ink-2 ring-1 ring-[var(--hairline-strong)]"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-paper transition-transform ${
                    enabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                  style={{
                    transform: enabled
                      ? "translateX(18px)"
                      : "translateX(2px)",
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
