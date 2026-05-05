"use client";

/**
 * Builder onboarding flow — `/onboarding/growth`.
 *
 * Five steps:
 *   1. Connect LinkedIn (Composio dashboard → paste connectedAccountId)
 *   2. Connect X / Twitter (same flow)
 *   3. Product context — what is Maya building distribution for?
 *   4. Voice samples — paste 5-10 of your existing posts per platform
 *   5. Deploy — spin up Maya on Fly
 *
 * Single client component holds the draft + renders the active step. The
 * server-side `growthAgents.onboardingStep` is the source of truth for
 * which step we're on; this component mirrors it.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ConnectLinkedinStep } from "./_steps/ConnectLinkedinStep";
import { ConnectTwitterStep } from "./_steps/ConnectTwitterStep";
import { ProductContextStep } from "./_steps/ProductContextStep";
import { VoiceSamplesStep } from "./_steps/VoiceSamplesStep";
import { DeployStep } from "./_steps/DeployStep";
import { STEPS, emptyDraft, nextStep, prevStep, type OnboardingDraft, type StepId } from "./_state";

export default function GrowthOnboardingPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-paper-faint">Loading...</p>
        </Shell>
      }
    >
      <GrowthOnboardingBody />
    </Suspense>
  );
}

function GrowthOnboardingBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useQuery(api.onboarding.growth.pipeline.getMyGrowthAgent);
  const startOnboarding = useAction(
    api.onboarding.growth.pipeline.startGrowthOnboarding
  );
  const completeOAuth = useAction(
    api.integrations.composio.oauth.completeOAuth
  );
  const markOAuthConnected = useMutation(
    api.onboarding.growth.pipeline.markPlatformConnectedFromConnectedAccount
  );
  const setStep = useMutation(
    api.onboarding.growth.pipeline.setOnboardingStep
  );

  const [bootError, setBootError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OnboardingDraft>(() => emptyDraft());
  const oauthHandled = useRef(false);

  // Boot — idempotent. Creates the row if missing.
  useEffect(() => {
    let cancelled = false;
    void startOnboarding({}).catch((err: Error) => {
      if (cancelled) return;
      setBootError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [startOnboarding]);

  // Hydrate the draft from server state when the agent loads.
  useEffect(() => {
    if (!me?.agent) return;
    setDraft((d) => ({
      ...d,
      productContext: {
        productName: me.agent?.productContext?.productName ?? d.productContext.productName,
        oneLiner: me.agent?.productContext?.oneLiner ?? d.productContext.oneLiner,
        targetAudience:
          me.agent?.productContext?.targetAudience ?? d.productContext.targetAudience,
        primaryUrl: me.agent?.productContext?.primaryUrl ?? d.productContext.primaryUrl,
        focus: me.agent?.productContext?.focus ?? d.productContext.focus,
      },
      voiceSamples: {
        linkedin: me.agent?.voiceSamples?.linkedin?.length
          ? me.agent.voiceSamples.linkedin
          : d.voiceSamples.linkedin,
        twitter: me.agent?.voiceSamples?.twitter?.length
          ? me.agent.voiceSamples.twitter
          : d.voiceSamples.twitter,
      },
    }));
  }, [me]);

  useEffect(() => {
    if (oauthHandled.current || !me?.agent) return;
    if (searchParams.get("oauth") !== "callback") return;
    const provider = searchParams.get("provider");
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if ((provider !== "linkedin" && provider !== "twitter") || !code || !state) {
      return;
    }
    oauthHandled.current = true;
    void (async () => {
      try {
        const res = await completeOAuth({ provider, code, state });
        await markOAuthConnected({
          platform: provider,
          connectedAccountId: res.connectedAccountIdLocal,
        });
        await setStep({
          step: provider === "linkedin" ? "connect-twitter" : "product-context",
        });
      } catch (err) {
        setBootError((err as Error).message);
      } finally {
        router.replace("/onboarding/growth");
      }
    })();
  }, [searchParams, me?.agent, completeOAuth, markOAuthConnected, setStep, router]);

  const currentStep: StepId = me?.agent?.onboardingStep ?? "connect-linkedin";

  if (me === undefined) {
    return (
      <Shell>
        <p className="text-paper-faint">Loading…</p>
      </Shell>
    );
  }
  if (me === null) {
    return (
      <Shell>
        <p className="text-paper">
          Sign in to start. <a href="/sign-in" className="text-paper underline">Sign in</a>.
        </p>
      </Shell>
    );
  }
  if (bootError) {
    return (
      <Shell>
        <p className="mb-2 text-red-400">Something went wrong:</p>
        <p className="text-paper-faint">{bootError}</p>
      </Shell>
    );
  }

  if (currentStep === "complete") {
    router.push("/growth/dashboard");
    return (
      <Shell>
        <p className="text-paper-faint">Redirecting to your builder dashboard...</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <Breadcrumbs current={currentStep} />
      <div className="mt-12">
        {currentStep === "connect-linkedin" && (
          <ConnectLinkedinStep
            draft={draft}
            setDraft={setDraft}
            onNext={async () => {
              await setStep({ step: nextStep(currentStep) });
            }}
          />
        )}
        {currentStep === "connect-twitter" && (
          <ConnectTwitterStep
            draft={draft}
            setDraft={setDraft}
            onNext={async () => {
              await setStep({ step: nextStep(currentStep) });
            }}
            onBack={async () => {
              const p = prevStep(currentStep);
              if (p) await setStep({ step: p });
            }}
          />
        )}
        {currentStep === "product-context" && (
          <ProductContextStep
            draft={draft}
            setDraft={setDraft}
            onNext={async () => {
              await setStep({ step: nextStep(currentStep) });
            }}
            onBack={async () => {
              const p = prevStep(currentStep);
              if (p) await setStep({ step: p });
            }}
          />
        )}
        {currentStep === "voice-samples" && (
          <VoiceSamplesStep
            draft={draft}
            setDraft={setDraft}
            onNext={async () => {
              await setStep({ step: nextStep(currentStep) });
            }}
            onBack={async () => {
              const p = prevStep(currentStep);
              if (p) await setStep({ step: p });
            }}
          />
        )}
        {currentStep === "deploy" && (
          <DeployStep
            draft={draft}
            agentId={me.agent?._id ?? null}
            onComplete={async () => {
              await setStep({ step: "complete" });
              router.push("/growth/dashboard");
            }}
            onBack={async () => {
              const p = prevStep(currentStep);
              if (p) await setStep({ step: p });
            }}
          />
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-8 flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">
            Maya for Builders · onboarding
          </span>
          <a href="/" className="text-sm text-paper-faint hover:text-paper">
            ← exit
          </a>
        </header>
        {children}
      </div>
    </main>
  );
}

function Breadcrumbs({ current }: { current: StepId }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <nav className="flex flex-wrap items-center gap-2 text-xs">
      {STEPS.map((s, i) => (
        <span key={s.id} className="flex items-center gap-2">
          <span
            className={
              i === idx
                ? "font-mono uppercase tracking-widest text-paper"
                : i < idx
                  ? "font-mono uppercase tracking-widest text-paper-dim"
                  : "font-mono uppercase tracking-widest text-paper-faint"
            }
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="text-paper-faint">·</span>
          )}
        </span>
      ))}
    </nav>
  );
}
