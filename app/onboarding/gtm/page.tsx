"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Stage = "intake" | "research" | "deploy";

interface IntakeDraft {
  name: string;
  url: string;
  founderWhy: string;
  stage: "idea" | "live-beta" | "paid" | "unknown";
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  canRecordScreen: boolean;
  canShowFace: boolean;
  excludedAudiences: string;
}

const DEFAULT_DRAFT: IntakeDraft = {
  name: "",
  url: "",
  founderWhy: "",
  stage: "live-beta",
  weekGoal: "signups",
  canRecordScreen: true,
  canShowFace: false,
  excludedAudiences: "",
};

export default function GtmOnboardingPage() {
  return (
    <Suspense fallback={<Shell>Loading...</Shell>}>
      <GtmOnboardingBody />
    </Suspense>
  );
}

function GtmOnboardingBody() {
  const snapshot = useQuery(api.gtmMaya.researchLifecycle.getMyGtmSnapshot);
  const startOnboarding = useMutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding
  );
  const setAppProfile = useMutation(api.gtmMaya.researchLifecycle.setAppProfile);
  const createResearchJob = useMutation(
    api.gtmMaya.researchLifecycle.createResearchJob
  );
  const deployMaya = useAction(api.onboarding.gtm.deployMayaGtm.runMyGtmDeploy);

  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_DRAFT);
  const [stage, setStage] = useState<Stage>("intake");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void startOnboarding({
      channelPreference: "whatsapp",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).catch((err: Error) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [startOnboarding]);

  const canSubmit = useMemo(() => {
    return draft.url.trim().startsWith("http") && draft.name.trim().length > 0;
  }, [draft.name, draft.url]);

  async function saveAndQueueResearch() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const appId = await setAppProfile({
        name: draft.name.trim(),
        url: draft.url.trim(),
        founderWhy: draft.founderWhy.trim() || undefined,
        stage: draft.stage,
        weekGoal: draft.weekGoal,
        canRecordScreen: draft.canRecordScreen,
        canShowFace: draft.canShowFace,
        excludedAudiences: draft.excludedAudiences
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      const jobId = await createResearchJob({ appId, budgetUsd: 3 });
      setResearchJobId(String(jobId));
      setStage("research");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    setBusy(true);
    setError(null);
    try {
      const result = await deployMaya({});
      setDeployResult(
        result.ok
          ? `Deployed to ${result.flyAppId} (${result.machineId})`
          : `${result.stage}: ${result.message}`
      );
      if (result.ok) setStage("deploy");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (snapshot === undefined) {
    return <Shell>Loading...</Shell>;
  }

  return (
    <Shell>
      <div className="mb-10">
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-lime">
          ClawLaunch onboarding
        </p>
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Give Maya the product. She will go research the launch plan.
        </h1>
        <p className="mt-5 max-w-2xl text-paper-dim">
          This V1 keeps onboarding short. Maya infers likely customers from the
          product, runs a budgeted research job, then comes back with one
          primary channel, one secondary channel, and a calendar plan.
        </p>
      </div>

      <StepRail stage={stage} />

      {error && (
        <div className="mb-6 border border-red-400/40 bg-red-950/30 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {stage === "intake" && (
        <section className="space-y-5">
          <Field label="Product name">
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((d) => ({ ...d, name: event.target.value }))
              }
              className="input"
              placeholder="ClawLaunch"
            />
          </Field>
          <Field label="Product URL">
            <input
              value={draft.url}
              onChange={(event) =>
                setDraft((d) => ({ ...d, url: event.target.value }))
              }
              className="input"
              placeholder="https://..."
            />
          </Field>
          <Field label="Why did you build it?">
            <textarea
              value={draft.founderWhy}
              onChange={(event) =>
                setDraft((d) => ({ ...d, founderWhy: event.target.value }))
              }
              className="input min-h-28"
              placeholder="The real reason, not marketing copy."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current stage">
              <select
                value={draft.stage}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    stage: event.target.value as IntakeDraft["stage"],
                  }))
                }
                className="input"
              >
                <option value="idea">idea</option>
                <option value="live-beta">live beta</option>
                <option value="paid">paid</option>
                <option value="unknown">unknown</option>
              </select>
            </Field>
            <Field label="This week's goal">
              <select
                value={draft.weekGoal}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    weekGoal: event.target.value as IntakeDraft["weekGoal"],
                  }))
                }
                className="input"
              >
                <option value="feedback">feedback</option>
                <option value="signups">signups</option>
                <option value="demos">demos</option>
                <option value="revenue">revenue</option>
                <option value="unknown">unknown</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              label="I can record my screen"
              checked={draft.canRecordScreen}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canRecordScreen: checked }))
              }
            />
            <Toggle
              label="I am willing to show my face"
              checked={draft.canShowFace}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canShowFace: checked }))
              }
            />
          </div>
          <Field label="Audiences to avoid">
            <input
              value={draft.excludedAudiences}
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  excludedAudiences: event.target.value,
                }))
              }
              className="input"
              placeholder="enterprise buyers, agencies, students"
            />
          </Field>
          <button
            onClick={saveAndQueueResearch}
            disabled={!canSubmit || busy}
            className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Saving..." : "Start research"}
          </button>
        </section>
      )}

      {stage === "research" && (
        <section className="border border-paper-faint/15 bg-ink-2 p-6">
          <h2 className="mb-3 font-display text-2xl">Research job queued</h2>
          <p className="text-paper-dim">
            Job: <span className="font-mono text-paper">{researchJobId}</span>
          </p>
          <p className="mt-4 max-w-2xl text-paper-dim">
            The next sprint wires the actual research worker. For now this
            proves onboarding creates the GTM app and budgeted research job
            without touching creator Maya.
          </p>
          <button
            onClick={deploy}
            disabled={busy}
            className="mt-6 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Deploying..." : "Deploy Maya"}
          </button>
        </section>
      )}

      {stage === "deploy" && (
        <section className="border border-lime/30 bg-lime/10 p-6">
          <h2 className="mb-3 font-display text-2xl">Maya deployment started</h2>
          <p className="text-paper-dim">{deployResult}</p>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-10 flex items-center justify-between">
          <Link href="/clawlaunch" className="font-mono text-xs uppercase tracking-widest">
            ClawLaunch
          </Link>
          <Link href="/sign-in" className="text-sm text-paper-dim hover:text-paper">
            sign in
          </Link>
        </header>
        {children}
      </div>
    </main>
  );
}

function StepRail({ stage }: { stage: Stage }) {
  const steps: Stage[] = ["intake", "research", "deploy"];
  const current = steps.indexOf(stage);
  return (
    <div className="mb-10 grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step}
          className={
            index <= current
              ? "border border-lime/30 bg-lime/10 p-3 text-sm"
              : "border border-paper-faint/15 bg-ink-2 p-3 text-sm text-paper-faint"
          }
        >
          {step}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-paper-dim">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between border border-paper-faint/15 bg-ink-2 p-4 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-lime"
      />
    </label>
  );
}
