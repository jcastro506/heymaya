/**
 * Service-product onboarding layout.
 *
 * Wraps every step with a quiet progress strip + nav. Mirrors the creator-side
 * layout-less page convention but adds a thin shared chrome so all 11 steps
 * share the same visual language.
 *
 * No "Step X of Y" counter — per § 5 ("conversational, never a multi-step
 * form") the operator should feel like Maya is talking to them, not like
 * they're filling out a questionnaire.
 */

import type { ReactNode } from "react";

export const metadata = {
  title: "Get Maya · HeyMaya for trades",
};

export default function BusinessOnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-ink text-paper">
      {children}
    </div>
  );
}
