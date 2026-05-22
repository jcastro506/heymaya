"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Stage = "intake" | "research" | "deploy";

interface IntakeDraft {
  name: string;
  url: string;
  founderWhy: string;
  stage: "idea" | "live-beta" | "paid" | "unknown";
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  canRecordScreen: boolean;
  canShowFace: boolean;
  canRecordVoice: boolean;
  canProvideScreenshots: boolean;
  canPostTikTokManually: boolean;
  canPostInstagramManually: boolean;
  existingTikTokUrl: string;
  existingInstagramUrl: string;
  openToUgcCreators: boolean;
  creatorBudgetMonthlyUsd: string;
  maxWeeklyVisualPosts: string;
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
  canRecordVoice: false,
  canProvideScreenshots: true,
  canPostTikTokManually: true,
  canPostInstagramManually: false,
  existingTikTokUrl: "",
  existingInstagramUrl: "",
  openToUgcCreators: false,
  creatorBudgetMonthlyUsd: "",
  maxWeeklyVisualPosts: "3",
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
  const generateWalkthroughUploadUrl = useMutation(
    api.gtmMaya.walkthrough.generateWalkthroughUploadUrl
  );
  const registerWalkthroughUpload = useMutation(
    api.gtmMaya.walkthrough.registerWalkthroughUpload
  );
  const createResearchJob = useMutation(
    api.gtmMaya.researchLifecycle.createResearchJob
  );
  const runResearchSkeleton = useMutation(
    api.gtmMaya.researchWorker.runBudgetedResearchSkeleton
  );
  const inspectApp = useAction(api.gtmMaya.appInspector.inspectMyGtmApp);
  const analyzeWalkthrough = useAction(
    api.gtmMaya.walkthrough.analyzeMyWalkthroughUpload
  );
  const deployMaya = useAction(api.onboarding.gtm.deployMayaGtm.runMyGtmDeploy);

  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_DRAFT);
  const [walkthroughFile, setWalkthroughFile] = useState<File | null>(null);
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
        canRecordVoice: draft.canRecordVoice,
        canProvideScreenshots: draft.canProvideScreenshots,
        canPostTikTokManually: draft.canPostTikTokManually,
        canPostInstagramManually: draft.canPostInstagramManually,
        existingTikTokUrl: emptyToUndefined(draft.existingTikTokUrl),
        existingInstagramUrl: emptyToUndefined(draft.existingInstagramUrl),
        openToUgcCreators: draft.openToUgcCreators,
        creatorBudgetMonthlyUsd: numberOrUndefined(draft.creatorBudgetMonthlyUsd),
        maxWeeklyVisualPosts: numberOrUndefined(draft.maxWeeklyVisualPosts),
        excludedAudiences: draft.excludedAudiences
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      if (walkthroughFile) {
        const uploadUrl = await generateWalkthroughUploadUrl({});
        const uploadRes = await fetch(uploadUrl, {
          method: "POST",
          headers: { "content-type": walkthroughFile.type },
          body: walkthroughFile,
        });
        if (!uploadRes.ok) {
          throw new Error(`walkthrough upload failed: ${uploadRes.status}`);
        }
        const { storageId } = (await uploadRes.json()) as { storageId: string };
        const uploadId = await registerWalkthroughUpload({
          appId,
          storageId: storageId as Id<"_storage">,
          filename: walkthroughFile.name,
          mimeType: walkthroughFile.type,
          bytes: walkthroughFile.size,
        });
        await analyzeWalkthrough({ uploadId });
      } else {
        await inspectApp({ appId });
      }
      const jobId = await createResearchJob({ appId, budgetUsd: 3 });
      await runResearchSkeleton({ researchJobId: jobId });
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
          <Field label="Mobile walkthrough recording">
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
              onChange={(event) =>
                setWalkthroughFile(event.target.files?.[0] ?? null)
              }
              className="input"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Toggle
              label="I can record my screen"
              checked={draft.canRecordScreen}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canRecordScreen: checked }))
              }
            />
            <Toggle
              label="I can record voiceover"
              checked={draft.canRecordVoice}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canRecordVoice: checked }))
              }
            />
            <Toggle
              label="I am willing to show my face"
              checked={draft.canShowFace}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canShowFace: checked }))
              }
            />
            <Toggle
              label="I can provide screenshots or slides"
              checked={draft.canProvideScreenshots}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canProvideScreenshots: checked }))
              }
            />
            <Toggle
              label="I will manually post on TikTok"
              checked={draft.canPostTikTokManually}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canPostTikTokManually: checked }))
              }
            />
            <Toggle
              label="I will manually post on Instagram"
              checked={draft.canPostInstagramManually}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, canPostInstagramManually: checked }))
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="TikTok profile, if any">
              <input
                value={draft.existingTikTokUrl}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    existingTikTokUrl: event.target.value,
                  }))
                }
                className="input"
                placeholder="https://www.tiktok.com/@..."
              />
            </Field>
            <Field label="Instagram profile, if any">
              <input
                value={draft.existingInstagramUrl}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    existingInstagramUrl: event.target.value,
                  }))
                }
                className="input"
                placeholder="https://www.instagram.com/..."
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Toggle
              label="I am open to UGC creators later"
              checked={draft.openToUgcCreators}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, openToUgcCreators: checked }))
              }
            />
            <Field label="Creator budget per month">
              <input
                type="number"
                min="0"
                value={draft.creatorBudgetMonthlyUsd}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    creatorBudgetMonthlyUsd: event.target.value,
                  }))
                }
                className="input"
                placeholder="0"
              />
            </Field>
            <Field label="Visual posts per week">
              <input
                type="number"
                min="0"
                value={draft.maxWeeklyVisualPosts}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    maxWeeklyVisualPosts: event.target.value,
                  }))
                }
                className="input"
                placeholder="3"
              />
            </Field>
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
            {busy ? "Researching..." : "Start research"}
          </button>
        </section>
      )}

      {stage === "research" && (
        <section className="border border-paper-faint/15 bg-ink-2 p-6">
          <h2 className="mb-3 font-display text-2xl">Research pass complete</h2>
          <p className="text-paper-dim">
            Job: <span className="font-mono text-paper">{researchJobId}</span>
          </p>
          <p className="mt-4 max-w-2xl text-paper-dim">
            The skeleton pass created evidence, channel scores, and zero-spend
            cost ledger rows. The next adapter layer swaps in live
            ScrapeCreators and platform research behind the same budgeted job
            contract.
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

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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
