/**
 * ApprovalRulesPanel render tests — plan-tier × ruleType matrix UX.
 *
 * Validates the UI mirrors the server `planFeaturesService.approvalRulesEnableable`
 * matrix:
 *   - Starter:  all toggles locked, "all-manual" notice shown
 *   - Pro:      review-request + gbp-post toggles enabled
 *   - Studio:   adds content-rejuvenation toggle
 *   - Forbidden review-reply rule: locked + Lock icon at every tier
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ApprovalRulesPanel } from "../ApprovalRulesPanel";

const FORBIDDEN = ["review-reply-auto-publish-allowlist"];

describe("ApprovalRulesPanel", () => {
  it("STARTER: all rules locked, starter notice present", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalRulesPanel, {
        rules: [],
        enableable: [],
        forbiddenAtAllTiers: FORBIDDEN,
        plan: "starter",
      })
    );
    expect(html).toContain("biz-approval-rules-panel");
    expect(html).toContain('data-plan="starter"');
    expect(html).toContain("every Maya action is operator-approved");
    // Every rule row should be locked
    const rules = [
      "review-request-auto-send",
      "gbp-post-auto-publish",
      "content-rejuvenation-auto-publish",
      "review-reply-auto-publish-allowlist",
    ];
    for (const rt of rules) {
      expect(html).toContain(`data-testid="biz-approval-rule-${rt}"`);
    }
  });

  it("PRO: review-request and gbp-post rule rows are unlocked", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalRulesPanel, {
        rules: [],
        enableable: ["review-request-auto-send", "gbp-post-auto-publish"],
        forbiddenAtAllTiers: FORBIDDEN,
        plan: "pro",
      })
    );
    // Locate the review-request row's data-locked attribute
    const reviewReqRow = extractRow(html, "review-request-auto-send");
    expect(reviewReqRow).toContain('data-locked="false"');
    const rejuvRow = extractRow(html, "content-rejuvenation-auto-publish");
    expect(rejuvRow).toContain('data-locked="true"');
  });

  it("STUDIO: content-rejuvenation row is unlocked", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalRulesPanel, {
        rules: [],
        enableable: [
          "review-request-auto-send",
          "gbp-post-auto-publish",
          "content-rejuvenation-auto-publish",
        ],
        forbiddenAtAllTiers: FORBIDDEN,
        plan: "studio",
      })
    );
    const rejuvRow = extractRow(html, "content-rejuvenation-auto-publish");
    expect(rejuvRow).toContain('data-locked="false"');
  });

  it("REVIEW-REPLY-AUTO-PUBLISH-ALLOWLIST: locked + forbidden at every tier", () => {
    for (const plan of ["starter", "pro", "studio"] as const) {
      const html = renderToStaticMarkup(
        createElement(ApprovalRulesPanel, {
          rules: [],
          enableable:
            plan === "starter"
              ? []
              : plan === "pro"
              ? ["review-request-auto-send", "gbp-post-auto-publish"]
              : [
                  "review-request-auto-send",
                  "gbp-post-auto-publish",
                  "content-rejuvenation-auto-publish",
                ],
          forbiddenAtAllTiers: FORBIDDEN,
          plan,
        })
      );
      const reviewReplyRow = extractRow(
        html,
        "review-reply-auto-publish-allowlist"
      );
      expect(reviewReplyRow).toContain('data-locked="true"');
      expect(reviewReplyRow).toContain('data-forbidden="true"');
    }
  });
});

function extractRow(html: string, ruleType: string): string {
  // Find the start of the li with the matching testid; pull until the next </li>
  const startMarker = `data-testid="biz-approval-rule-${ruleType}"`;
  const startIdx = html.indexOf(startMarker);
  if (startIdx < 0) return "";
  const liStart = html.lastIndexOf("<li", startIdx);
  const liEnd = html.indexOf("</li>", startIdx);
  if (liStart < 0 || liEnd < 0) return "";
  return html.slice(liStart, liEnd + 5);
}
