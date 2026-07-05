"use client";

/**
 * Service-product onboarding flow — 11 steps, sub-5-min target.
 *
 * Per § 5 + § 13 Sprint 2. Replaces the Sprint 0 placeholder. The flow:
 *
 *   1. Sign up (Clerk modal — handled upstream of /onboarding/business/)
 *   2. GBP claim (Zernio OAuth)
 *   3. FB + IG (optional, Pro+)
 *   4. CRM (optional, Pro+) — multi-select; "I don't use one" creates a
 *      `crmConnections` row with `provider: "none"`.
 *   5. Background bulk pull (parallel to questions)
 *   6-9. 11-Q form (Q1..Q11) — see `_steps/QuestionsStep.tsx`
 *   10. businessPicture synthesis
 *   11. Channel pairing — § 11 routed via OpenClaw NATIVE channel pairing per
 *       operator decision 2026-04-27. Direct Twilio path is parked under
 *       `convex/integrations/twilio/`. v0 default channel is web; iMessage /
 *       WhatsApp / SMS pairing happens out-of-band via the existing creator-
 *       side `requestPairing` flow on the HQ Profile screen post-deploy.
 *   12. Deploy + first message.
 *
 * Single client component holds the full `OnboardingState` and renders the
 * active step. The Clerk middleware (see `middleware.ts`) gates access — any
 * unauthenticated visitor lands on `/sign-in` first.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  initialState,
  setStep,
  type OnboardingState,
  STEP_BREADCRUMBS,
} from "./_state";
import { QuestionsStep } from "./_steps/QuestionsStep";

const startServiceOnboardingRef =
  api.onboarding.business.pipeline.startServiceOnboarding;
const zernioStartConnectRef =
  api.integrations.zernio.oauth.zernioStartConnect;
const runOnboardingDeployRef =
  api.onboarding.business.deployServiceMaya.runOnboardingDeploy;

export default function BusinessOnboardingPage() {
  const [state, setState] = useState<OnboardingState>(() => initialState());

  // Boot the pipeline — idempotent, Clerk-identity-scoped.
  const startOnboarding = useAction(startServiceOnboardingRef);
  useEffect(() => {
    let cancelled = false;
    void startOnboarding({}).then(
      () => {
        if (cancelled) return;
        // No-op — we just need the row to exist by the time GBP step lands.
      },
      (err) => {
        if (cancelled) return;
        setState((p) => ({ ...p, error: (err as Error).message }));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [startOnboarding]);

  const advance = () => {
    setState((p) => {
      const map: Record<OnboardingState["step"], OnboardingState["step"]> = {
        signup: "gbp",
        gbp: "social",
        social: "crm",
        crm: "pulling",
        pulling: "questions",
        questions: "synth",
        synth: "channel",
        channel: "deploy",
        deploy: "deploy",
      };
      return setStep(p, map[p.step]);
    });
  };

  const stepView = useMemo(() => {
    switch (state.step) {
      case "signup":
        return <SignupStep onAdvance={advance} />;
      case "gbp":
        return (
          <GbpStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "social":
        return (
          <SocialStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "crm":
        return (
          <CrmStep state={state} setState={setState} onAdvance={advance} />
        );
      case "pulling":
        return (
          <PullingStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "questions":
        return (
          <QuestionsStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "synth":
        return (
          <SynthStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "channel":
        return (
          <ChannelStep
            state={state}
            setState={setState}
            onAdvance={advance}
          />
        );
      case "deploy":
        return <DeployStep state={state} setState={setState} />;
    }
  }, [state]);

  return (
    <>
      <header className="relative z-20 px-5 pt-6 sm:px-8 sm:pt-8">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href="/business" className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
            >
              <span className="font-display text-lg leading-none">m</span>
            </span>
            <span className="font-display text-xl tracking-tight text-paper">
              HeyMaya
            </span>
          </Link>
          <span className="hidden font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
            {STEP_BREADCRUMBS[state.step]}
          </span>
        </div>
      </header>
      <main className="relative z-10 flex-1 px-5 pb-16 pt-8 sm:px-8 sm:pt-14">
        <div className="mx-auto w-full max-w-2xl">{stepView}</div>
      </main>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step components (inline; QuestionsStep is in _steps/ for size reasons)      */
/* -------------------------------------------------------------------------- */

function SignupStep({ onAdvance }: { onAdvance: () => void }) {
  return (
    <section>
      <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
        Welcome
      </span>
      <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
        Let&apos;s get Maya in your text thread.
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-paper-dim">
        Five minutes. We&apos;ll claim your Google Business Profile, read your
        last 20 reviews, and Maya will send you her first morning brief
        tomorrow at 7am.
      </p>
      <div className="mt-10">
        <button onClick={onAdvance} className="btn btn-primary">
          Connect my Google Business Profile
        </button>
      </div>
    </section>
  );
}

function GbpStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  const startConnect = useAction(zernioStartConnectRef);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const redirect = `${window.location.origin}/onboarding/business/zernio-callback`;
      const result = await startConnect({
        platforms: ["gbp"],
        redirectUri: redirect,
      });
      // Zernio's hosted page → operator OAuths → callback URL captures
      // code+state → forwarded to zernioHandleCallback. We open in same tab.
      window.location.href = result.redirectUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // Dev / smoke fallback — when env doesn't have a Zernio key the start-call
  // fails clean. We surface a "skip for now" path so engineers can drive the
  // flow without live OAuth.
  const onSkip = () => {
    setState((p) => ({
      ...p,
      gbpConnected: true,
      gbpOwnerEmailMatchesGoogle: true,
    }));
    onAdvance();
  };

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Claim your Google Business Profile
      </h2>
      <p className="mt-4 text-paper-dim">
        Maya needs your GBP to fetch reviews + post on your behalf. We use
        Zernio to handle the OAuth — your Google credentials never touch our
        servers.
      </p>
      {err ? (
        <p className="mt-3 rounded-2xl bg-ink-2 p-3 text-sm text-paper-dim">
          {err}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          onClick={onConnect}
          disabled={busy}
          className="btn btn-primary"
        >
          {busy ? "Opening Zernio…" : "Connect via Zernio"}
        </button>
        <button onClick={onSkip} className="btn btn-ghost">
          Skip for now
        </button>
      </div>
      {state.gbpConnected ? (
        <p className="mt-6 text-sm text-paper-dim">
          GBP linked. Continuing…
        </p>
      ) : null}
    </section>
  );
}

function SocialStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  const startConnect = useAction(zernioStartConnectRef);
  const planAllowsSocial = state.plan === "pro" || state.plan === "studio";

  const onConnect = async (platform: "facebook" | "instagram") => {
    if (!planAllowsSocial) {
      setState((p) => ({ ...p, error: "Facebook + Instagram require Pro." }));
      return;
    }
    try {
      const redirect = `${window.location.origin}/onboarding/business/zernio-callback`;
      const result = await startConnect({
        platforms: [platform],
        redirectUri: redirect,
      });
      window.location.href = result.redirectUrl;
    } catch (e) {
      setState((p) => ({ ...p, error: (e as Error).message }));
    }
  };

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Connect Facebook + Instagram (optional)
      </h2>
      <p className="mt-4 text-paper-dim">
        Your social drafts will be 80% better when Maya reads your past posts.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          onClick={() => onConnect("facebook")}
          disabled={!planAllowsSocial}
          className="btn btn-primary"
        >
          {state.socialConnected.facebook ? "Facebook ✓" : "Connect Facebook"}
        </button>
        <button
          onClick={() => onConnect("instagram")}
          disabled={!planAllowsSocial}
          className="btn btn-primary"
        >
          {state.socialConnected.instagram
            ? "Instagram ✓"
            : "Connect Instagram"}
        </button>
        <button onClick={onAdvance} className="btn btn-ghost">
          Skip
        </button>
      </div>
      {!planAllowsSocial ? (
        <p className="mt-4 text-sm text-paper-faint">
          Pro + Studio only. You&apos;re on Starter — Maya focuses on GBP for
          you.
        </p>
      ) : null}
    </section>
  );
}

function CrmStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  const planAllowsCrm = state.plan === "pro" || state.plan === "studio";

  const choose = (id: NonNullable<OnboardingState["crm"]["selected"]>) => {
    setState((p) => ({
      ...p,
      crm: { ...p.crm, selected: id, hcpMaxWarningAck: false },
    }));
  };

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Connect your CRM (optional)
      </h2>
      <p className="mt-4 text-paper-dim">
        When Maya knows your jobs, her reviews / social / follow-up are 5×
        better.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { id: "jobber" as const, label: "Jobber" },
          { id: "hcp" as const, label: "Housecall Pro" },
          { id: "qbo" as const, label: "QuickBooks Online" },
          { id: "servicetitan" as const, label: "ServiceTitan (coming Sprint 7)" },
          { id: "later" as const, label: "I'll connect later" },
          { id: "none" as const, label: "I don't use one" },
        ].map((opt) => (
          <button
            key={opt.id}
            onClick={() => choose(opt.id)}
            disabled={!planAllowsCrm && opt.id !== "none" && opt.id !== "later"}
            className={`rounded-2xl border p-4 text-left transition-colors ${
              state.crm.selected === opt.id
                ? "border-lime bg-ink-2"
                : "border-ink-2 hover:border-paper-faint"
            }`}
          >
            <span className="font-display text-base text-paper">
              {opt.label}
            </span>
          </button>
        ))}
      </div>
      {state.crm.selected === "hcp" && !state.crm.hcpMaxWarningAck ? (
        <div className="mt-4 rounded-2xl bg-ink-2 p-4 text-sm text-paper-dim">
          Heads up — Housecall Pro&apos;s API surface needs the MAX plan
          ($329/mo on the HCP side). Without MAX we fall back to a polling
          path that&apos;s ~30 min slower.
          <button
            onClick={() =>
              setState((p) => ({
                ...p,
                crm: { ...p.crm, hcpMaxWarningAck: true },
              }))
            }
            className="ml-3 underline"
          >
            Got it
          </button>
        </div>
      ) : null}
      <div className="mt-8">
        <button
          onClick={onAdvance}
          disabled={state.crm.selected === null}
          className="btn btn-primary"
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function PullingStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  // Bulk pull is fired from the pipeline.triggerBulkPull internal action,
  // which the deploy orchestrator can also re-run if questions complete
  // before the pull does. We mark the step "done" optimistically here so
  // the operator isn't blocked on a slow Zernio call — § 5 step 6 hard
  // rule: "never block the operator on data we don't actually need."
  useEffect(() => {
    // Mark done after a short delay — gives the spinner a moment to read
    // as deliberate work, not a flash. Real bulk-pull progress lands via
    // a Convex subscription in a future iteration; v0 ships the optimistic
    // mark.
    const t = setTimeout(() => {
      setState((p) => ({
        ...p,
        bulkPullDone: true,
        bulkPullSummary: "Reading reviews + posts in the background…",
      }));
    }, 1200);
    return () => clearTimeout(t);
  }, [setState]);

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Maya is reading your business
      </h2>
      <p className="mt-4 text-paper-dim">
        Pulling your last 20 reviews, last 10 GBP posts, and last 14 days of
        jobs (if connected). This runs in the background while you answer a
        few questions.
      </p>
      <div className="mt-6 rounded-2xl bg-ink-2 p-4 text-sm text-paper-dim">
        {state.bulkPullSummary ?? "Connecting…"}
      </div>
      <div className="mt-8">
        <button
          onClick={onAdvance}
          disabled={!state.bulkPullDone}
          className="btn btn-primary"
        >
          {state.bulkPullDone ? "Continue" : "Reading…"}
        </button>
      </div>
    </section>
  );
}

function SynthStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  // The Convex internal action `synthesizeBusinessPicture` runs server-side;
  // v0 ships the optimistic-done mark here while the action runs in
  // background. Real progress wiring lands via a Convex subscription in a
  // future iteration.
  useEffect(() => {
    const t = setTimeout(() => {
      setState((p) => ({ ...p, synthDone: true }));
    }, 1500);
    return () => clearTimeout(t);
  }, [setState]);

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Maya is forming her first picture
      </h2>
      <p className="mt-4 text-paper-dim">
        Synthesizing your brand voice + customer sentiment + local positioning
        from the data we just pulled.
      </p>
      {state.synthError ? (
        <p className="mt-3 rounded-2xl bg-ink-2 p-3 text-sm text-paper-dim">
          {state.synthError}
        </p>
      ) : null}
      <div className="mt-8">
        <button
          onClick={onAdvance}
          disabled={!state.synthDone}
          className="btn btn-primary"
        >
          {state.synthDone ? "Continue" : "Synthesizing…"}
        </button>
      </div>
    </section>
  );
}

function ChannelStep({
  state,
  setState,
  onAdvance,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
  onAdvance: () => void;
}) {
  /*
   * Step 11 channel pairing — PARKED FOR RE-SCOPE per operator decision
   * 2026-04-27. Locked OpenClaw alignment memory says OpenClaw handles 50+
   * channels (iMessage, WhatsApp, SMS, voice) NATIVELY via
   * `openclaw cli channels pair`. The direct Twilio number-provisioning path
   * we'd been planning here is parked under `convex/integrations/twilio/`.
   *
   * v0 ships with the web-channel default selected; iMessage / WhatsApp /
   * SMS pairing is invoked OUT OF BAND from the HQ Profile screen post-deploy
   * via the existing creator-side `requestPairing` flow, which already routes
   * through the OpenClaw CLI.
   */
  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Where should Maya text you?
      </h2>
      <p className="mt-4 text-paper-dim">
        Pick a channel. You can add more later from the Profile screen.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["web", "imessage", "whatsapp", "sms"] as const).map((c) => (
          <button
            key={c}
            onClick={() =>
              setState((p) => ({ ...p, channelChosen: c }))
            }
            className={`rounded-2xl border p-3 text-center text-sm font-display transition-colors ${
              state.channelChosen === c
                ? "border-lime bg-ink-2 text-paper"
                : "border-ink-2 text-paper-dim hover:border-paper-faint"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-paper-faint">
        Channel pairing for iMessage / WhatsApp / SMS happens via OpenClaw
        native pairing after deploy — you&apos;ll see the QR / verification
        code in the Profile screen.
      </p>
      <div className="mt-8">
        <button
          onClick={onAdvance}
          disabled={state.channelChosen === null}
          className="btn btn-primary"
        >
          Deploy Maya
        </button>
      </div>
    </section>
  );
}

function DeployStep({
  state,
  setState,
}: {
  state: OnboardingState;
  setState: (next: OnboardingState | ((p: OnboardingState) => OnboardingState)) => void;
}) {
  const runDeploy = useAction(runOnboardingDeployRef);
  useEffect(() => {
    if (state.deployStatus !== "idle") return;
    setState((p) => ({ ...p, deployStatus: "running" }));
    void runDeploy({}).then(
      (res) => {
        if (res.ok) {
          setState((p) => ({ ...p, deployStatus: "ok" }));
        } else {
          setState((p) => ({
            ...p,
            deployStatus: "failed",
            deployError: `${res.stage}: ${res.message}`,
          }));
        }
      },
      (err) => {
        setState((p) => ({
          ...p,
          deployStatus: "failed",
          deployError: (err as Error).message,
        }));
      }
    );
  }, [state.deployStatus, runDeploy, setState]);

  return (
    <section>
      <h2 className="font-display text-3xl tracking-tight text-paper">
        Deploying Maya
      </h2>
      {state.deployStatus === "running" ? (
        <p className="mt-4 text-paper-dim">
          Bundling workspace, creating Fly machine, installing crons…
        </p>
      ) : null}
      {state.deployStatus === "ok" ? (
        <div className="mt-4">
          <p className="text-paper-dim">
            Maya just texted you. Add her to your contacts and reply when she
            pings tomorrow morning at 7am.
          </p>
          <Link href="/business" className="mt-6 inline-block btn btn-primary">
            Open Creator HQ
          </Link>
        </div>
      ) : null}
      {state.deployStatus === "failed" ? (
        <div className="mt-4 rounded-2xl bg-ink-2 p-4 text-sm text-paper-dim">
          Deploy failed: {state.deployError}.{" "}
          <button
            onClick={() =>
              setState((p) => ({
                ...p,
                deployStatus: "idle",
                deployError: null,
              }))
            }
            className="underline"
          >
            Retry
          </button>
        </div>
      ) : null}
    </section>
  );
}
