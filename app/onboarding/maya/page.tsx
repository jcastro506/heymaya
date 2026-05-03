"use client";

/**
 * Sprint 2 conversational onboarding entry point.
 *
 * Single-page client component that holds the full `OnboardingState` and
 * renders the active step from `_steps/`. State machine + transitions live
 * in `_state.ts` so they're trivially unit-testable.
 *
 * The Clerk middleware (see `middleware.ts`) protects this route — any
 * unauthenticated visitor is redirected to /sign-in before they can land
 * here, which means `useQuery(api.creators.me)` always has an identity to
 * resolve once it lands.
 *
 * Why no router-state for the active step (intentional):
 *   - Sub-4-min onboarding bounces if the back button drops the creator on
 *     a half-finished step. We model progression in memory only.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  initialState,
  setStep,
  type ChannelState,
  type OnboardingState,
  type Plan,
} from "./_state";
import { HandlesStep } from "./_steps/HandlesStep";
import { PullingStep } from "./_steps/PullingStep";
import { QuestionsStep } from "./_steps/QuestionsStep";
import { ChannelStep } from "./_steps/ChannelStep";
import { ComposioStep } from "./_steps/ComposioStep";
import { DeployStep } from "./_steps/DeployStep";

export default function MayaOnboardingPage() {
  const me = useQuery(api.creators.me);

  // Local state machine. `me` is loaded async so we initialize with starter
  // and patch the plan in once Convex resolves.
  const [state, setState] = useState<OnboardingState>(() => initialState());
  useEffect(() => {
    if (!me?.plan) return;
    setState((prev) => (prev.plan === me.plan ? prev : { ...prev, plan: me.plan as Plan }));
  }, [me?.plan]);

  const handleAdvance = () => {
    setState((prev) => {
      switch (prev.step) {
        case "handles":
          return setStep(prev, "pulling");
        case "pulling":
          return setStep(prev, "questions");
        case "questions":
          return setStep(prev, "channel");
        case "channel":
          return setStep(prev, "composio");
        case "composio":
          return setStep(prev, "deploy");
        case "deploy":
          return prev;
      }
    });
  };

  // Per-step adapters. Each step receives only the slice + setters it needs.
  const setChannel = (next: ChannelState) =>
    setState((prev) => ({ ...prev, channel: next }));
  const onScrapeComplete = () =>
    setState((prev) => (prev.scrapeComplete ? prev : { ...prev, scrapeComplete: true }));

  // Render-time guard: while Convex is still resolving the creator we show a
  // minimal skeleton instead of flashing the wrong plan caps.
  const ready = me !== undefined;
  const stepContent = useMemo(() => {
    if (!ready) return <BootSkeleton />;
    switch (state.step) {
      case "handles":
        return (
          <HandlesStep
            state={state}
            setState={setState}
            onAdvance={handleAdvance}
          />
        );
      case "pulling":
        return (
          <PullingStep
            state={state}
            setState={setState}
            onScrapeComplete={onScrapeComplete}
            onAdvance={handleAdvance}
          />
        );
      case "questions":
        return (
          <QuestionsStep
            state={state}
            setOnboardingState={setState}
            onAdvance={handleAdvance}
          />
        );
      case "channel":
        return (
          <ChannelStep
            state={state}
            setChannel={setChannel}
            onAdvance={handleAdvance}
          />
        );
      case "composio":
        return (
          <ComposioStep
            state={state}
            setState={setState}
            onAdvance={handleAdvance}
          />
        );
      case "deploy":
        return <DeployStep state={state} />;
    }
    // Exhaustiveness fallback — TS will complain on a new step that isn't handled.
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reactivity flows through state setter functions: re-memoizing on each setter would defeat the purpose
  }, [state, ready]);

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <OnboardingNav step={state.step} />
      <main className="relative z-10 flex-1">{stepContent}</main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav + skeleton                                                              */
/* -------------------------------------------------------------------------- */

function OnboardingNav({ step }: { step: OnboardingState["step"] }) {
  return (
    <header className="relative z-20 px-5 pt-6 sm:px-8 sm:pt-8">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <Link
          href="/"
          className="group inline-flex items-center gap-2"
          aria-label="HeyMaya home"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
            style={{ boxShadow: "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)" }}
          >
            <span className="font-display text-lg leading-none">m</span>
          </span>
          <span className="font-display text-xl tracking-tight text-paper">
            HeyMaya
          </span>
        </Link>
        {/*
          Intentionally no "Step 3 of 6" indicator — a multi-step counter
          turns onboarding into a form. Instead we surface a quiet "what
          Maya's doing right now" line, which feels conversational and
          matches the editorial vocabulary of the landing page.
        */}
        <span className="hidden font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
          {STEP_BREADCRUMB[step]}
        </span>
      </div>
    </header>
  );
}

const STEP_BREADCRUMB: Record<OnboardingState["step"], string> = {
  handles: "Add your accounts",
  pulling: "Maya is reading",
  questions: "Maya wants to ask you a few things",
  channel: "Pick where Maya texts you",
  composio: "Connect your tools",
  deploy: "Deploying Maya",
};

function BootSkeleton() {
  return (
    <section className="mx-auto w-full max-w-2xl px-5 pb-16 pt-8 sm:px-8 sm:pt-14">
      <div className="h-3 w-24 rounded-full bg-ink-2" />
      <div className="mt-6 h-12 w-3/4 rounded-2xl bg-ink-2" />
      <div className="mt-6 h-5 w-2/3 rounded-2xl bg-ink-2" />
      <div className="mt-10 space-y-3">
        <div className="h-14 rounded-2xl bg-ink-2" />
        <div className="h-14 rounded-2xl bg-ink-2" />
        <div className="h-14 rounded-2xl bg-ink-2" />
      </div>
    </section>
  );
}
