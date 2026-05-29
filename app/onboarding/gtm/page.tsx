"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Stage = "intake" | "research" | "deploy";

interface IntakeDraft {
  name: string;
  url: string;
  founderWhy: string;
  stage: "idea" | "live-beta" | "paid" | "unknown";
  entryMode: "launch" | "manager";
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  canRecordScreen: boolean;
  canShowFace: boolean;
  canRecordVoice: boolean;
  canProvideScreenshots: boolean;
  canPostTikTokManually: boolean;
  canPostInstagramManually: boolean;
  existingTikTokUrl: string;
  existingInstagramUrl: string;
  existingYoutubeUrl: string;
  existingLinkedinUrl: string;
  tiktokWarmupState:
    | "unknown"
    | "new_needs_warmup"
    | "warming"
    | "ready"
    | "restricted";
  tiktokAccountAgeDays: string;
  tiktokAccountStatusChecked: boolean;
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
  entryMode: "manager",
  weekGoal: "signups",
  canRecordScreen: true,
  canShowFace: false,
  canRecordVoice: false,
  canProvideScreenshots: true,
  canPostTikTokManually: true,
  canPostInstagramManually: false,
  existingTikTokUrl: "",
  existingInstagramUrl: "",
  existingYoutubeUrl: "",
  existingLinkedinUrl: "",
  tiktokWarmupState: "unknown",
  tiktokAccountAgeDays: "",
  tiktokAccountStatusChecked: false,
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
  // Wait until Convex actually has the Clerk identity before calling any
  // auth-required mutation. Right after sign-up the token takes a beat to
  // propagate; firing startOnboarding too early throws "signed-in user
  // required" — a race, not a real error.
  const { isAuthenticated } = useConvexAuth();
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
  // Sprint 1 — real research orchestrator (Sprint 3 + Sprint 4).
  // Replaces the prior runBudgetedResearchSkeleton call. The skeleton
  // mutation is kept in the Convex codebase for tests + emergency
  // fallback but is no longer in the production onboarding path.
  const runResearch = useAction(api.gtmMaya.researchWorker.runMyResearch);
  const inspectApp = useAction(api.gtmMaya.appInspector.inspectMyGtmApp);
  const analyzeWalkthrough = useAction(
    api.gtmMaya.walkthrough.analyzeMyWalkthroughUpload
  );
  const deployMaya = useAction(api.onboarding.gtm.deployMayaGtm.runMyGtmDeploy);
  // Sprint 2.26b — operator pastes their personal Telegram bot token
  // (from BotFather). Action validates via getMe, encrypts, stores on
  // gtmAgents row, then deploy reads it back via internal query.
  const setPersonalTelegramBot = useAction(
    api.gtmMaya.telegramBotPerTenant.validateAndSetPersonalTelegramBot
  );

  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_DRAFT);
  const [walkthroughFile, setWalkthroughFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("intake");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<string | null>(null);
  // Sprint 2.26b — Telegram bot state. Operator can connect their own
  // bot from BotFather OR opt into the shared dev fallback.
  const [botToken, setBotToken] = useState("");
  const [botStatus, setBotStatus] = useState<
    | { kind: "idle" }
    | { kind: "validating" }
    | { kind: "connected"; username: string }
    | { kind: "error"; message: string }
    | { kind: "shared_fallback" }
  >({ kind: "idle" });

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    void startOnboarding({
      // Sprint 15 (Part II D1): Telegram is the ClawLaunch channel default.
      // WhatsApp pairing is QR-only and can't be self-served; iMessage
      // requires a macOS host. Pairing happens after deploy via the
      // `Open Maya in Telegram` deep link surfaced on the deploy screen.
      channelPreference: "telegram",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).catch((err) => {
      if (!cancelled) setError(friendlyError(err));
    });
    return () => {
      cancelled = true;
    };
  }, [startOnboarding, isAuthenticated]);

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
        entryMode: draft.entryMode,
        weekGoal: draft.weekGoal,
        canRecordScreen: draft.canRecordScreen,
        canShowFace: draft.canShowFace,
        canRecordVoice: draft.canRecordVoice,
        canProvideScreenshots: draft.canProvideScreenshots,
        canPostTikTokManually: draft.canPostTikTokManually,
        canPostInstagramManually: draft.canPostInstagramManually,
        existingTikTokUrl: emptyToUndefined(draft.existingTikTokUrl),
        existingInstagramUrl: emptyToUndefined(draft.existingInstagramUrl),
        existingYoutubeUrl: emptyToUndefined(draft.existingYoutubeUrl),
        existingLinkedinUrl: emptyToUndefined(draft.existingLinkedinUrl),
        tiktokWarmupState: draft.tiktokWarmupState,
        tiktokAccountAgeDays: numberOrUndefined(draft.tiktokAccountAgeDays),
        tiktokAccountStatusChecked: draft.tiktokAccountStatusChecked,
        openToUgcCreators: draft.openToUgcCreators,
        creatorBudgetMonthlyUsd: numberOrUndefined(draft.creatorBudgetMonthlyUsd),
        maxWeeklyVisualPosts: numberOrUndefined(draft.maxWeeklyVisualPosts),
        excludedAudiences: draft.excludedAudiences
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      // Always crawl the site for a landing-page diagnosis. Even mobile apps
      // have a landing/store URL worth reading. This must run BEFORE the
      // walkthrough analysis: persistAppDiagnosis REPLACES gtmApps.diagnosis,
      // while analyzeWalkthrough MERGES its result under `.walkthrough` — so
      // inspecting first preserves both signals; the reverse order clobbers.
      await inspectApp({ appId });
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
      }
      const jobId = await createResearchJob({ appId, budgetUsd: 3 });
      // Sprint 1: real research orchestrator. This action may take
      // 1-3 minutes (5 platform workers in parallel, ~30 ScrapeCreators
      // calls total at the default budget). The mission board polls
      // gtmResearchJobs.phase for live progress.
      void runResearch({ researchJobId: jobId });
      setResearchJobId(String(jobId));
      setStage("research");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function connectBot() {
    setBotStatus({ kind: "validating" });
    try {
      const result = await setPersonalTelegramBot({
        botToken: botToken.trim(),
      });
      setBotStatus({ kind: "connected", username: result.botUsername });
    } catch (err) {
      setBotStatus({
        kind: "error",
        message: (err as Error).message || "validation failed",
      });
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
      setError(friendlyError(err));
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
        <p className="mb-3 font-mono text-xs uppercase tracking-widest text-paper">
          ClawLaunch onboarding
        </p>
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Give Maya the product. She'll build your GTM operating model.
        </h1>
        <p className="mt-5 max-w-2xl text-paper-dim">
          Onboarding is short. After you finish here, Maya does ~10-15 min of
          deep market research — your ICP, the competitive landscape, where
          your buyers hang out, narrative angles you can run from, and the
          specific accounts worth building relationships with. Then she
          starts a daily cadence: morning brief, evening recap, weekly
          strategy review.
        </p>
      </div>

      <StepRail stage={stage} />

      {error && (
        <div className="mb-6 rounded border border-red-600 bg-red-50 p-4 text-sm text-red-700">
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
          <Field label="Where are you?">
            <select
              value={draft.entryMode}
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  entryMode: event.target.value as IntakeDraft["entryMode"],
                }))
              }
              className="input"
            >
              <option value="manager">
                I&apos;m live — take over my social, tell me what to post
              </option>
              <option value="launch">
                I haven&apos;t launched yet — plan my go-to-market
              </option>
            </select>
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
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-paper bg-ink-2 px-4 py-2 text-sm font-medium hover:bg-ink-3">
                {walkthroughFile ? "Choose a different video" : "Choose video"}
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
                  onChange={(event) =>
                    setWalkthroughFile(event.target.files?.[0] ?? null)
                  }
                  className="hidden"
                />
              </label>
              {walkthroughFile ? (
                <>
                  <span className="text-sm text-paper-dim">
                    {walkthroughFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWalkthroughFile(null)}
                    className="rounded-lg border border-paper px-3 py-1.5 text-xs font-medium hover:bg-ink-3"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-sm text-paper-faint">No file chosen</span>
              )}
            </div>
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
            <Field label="TikTok account status">
              <select
                value={draft.tiktokWarmupState}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    tiktokWarmupState: event.target.value as IntakeDraft["tiktokWarmupState"],
                  }))
                }
                className="input"
              >
                <option value="unknown">Not sure yet</option>
                <option value="new_needs_warmup">New account</option>
                <option value="warming">Currently warming up</option>
                <option value="ready">Ready / already active</option>
                <option value="restricted">Restricted or warnings</option>
              </select>
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
            <Field label="YouTube channel, if any">
              <input
                value={draft.existingYoutubeUrl}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    existingYoutubeUrl: event.target.value,
                  }))
                }
                className="input"
                placeholder="https://www.youtube.com/@..."
              />
            </Field>
            <Field label="LinkedIn profile, if any">
              <input
                value={draft.existingLinkedinUrl}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    existingLinkedinUrl: event.target.value,
                  }))
                }
                className="input"
                placeholder="https://www.linkedin.com/in/..."
              />
            </Field>
            <Field label="TikTok account age in days">
              <input
                value={draft.tiktokAccountAgeDays}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    tiktokAccountAgeDays: event.target.value,
                  }))
                }
                className="input"
                inputMode="numeric"
                placeholder="0"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Toggle
              label="I checked TikTok Account Check"
              checked={draft.tiktokAccountStatusChecked}
              onChange={(checked) =>
                setDraft((d) => ({ ...d, tiktokAccountStatusChecked: checked }))
              }
            />
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
        <section className="border border-paper bg-ink-2 p-6">
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

          {/* Sprint 2.26b — Telegram bot setup gate. Operator either
              connects their own bot from BotFather (recommended for
              production) or uses the shared dev fallback (testing). */}
          <div className="mt-6 border border-paper bg-ink p-5">
            <h3 className="mb-2 font-display text-lg">
              Connect your Telegram bot
            </h3>
            <p className="text-sm text-paper-dim">
              Your Maya lives in Telegram. Create your own bot (free, takes
              ~60 seconds) so messages route to YOU, not a shared dev bot.
            </p>

            {botStatus.kind === "connected" ? (
              <div className="mt-4 rounded border border-paper bg-ink-2 p-3 text-sm">
                Connected as{" "}
                <span className="font-mono">@{botStatus.username}</span>
              </div>
            ) : botStatus.kind === "shared_fallback" ? (
              <div className="mt-4 rounded border border-paper bg-ink-2 p-3 text-sm text-paper-dim">
                Using shared dev bot. Fine for testing — connect your own
                later from /profile.
              </div>
            ) : (
              <>
                <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-paper-dim">
                  <li>
                    Open Telegram, search{" "}
                    <span className="font-mono text-paper">@BotFather</span>
                  </li>
                  <li>
                    Send{" "}
                    <span className="font-mono text-paper">/newbot</span>,
                    pick a name + handle
                  </li>
                  <li>Copy the token BotFather sends back</li>
                  <li>Paste it below — we validate + encrypt it</li>
                </ol>
                <div className="mt-4 flex gap-2">
                  <input
                    type="password"
                    placeholder="1234567890:ABC-XYZ-bot-token-here"
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                    className="input flex-1 font-mono text-xs"
                    disabled={botStatus.kind === "validating"}
                  />
                  <button
                    onClick={connectBot}
                    disabled={
                      botStatus.kind === "validating" ||
                      botToken.trim().length < 20
                    }
                    className="rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {botStatus.kind === "validating"
                      ? "Validating..."
                      : "Connect"}
                  </button>
                </div>
                {botStatus.kind === "error" && (
                  <p className="mt-2 text-sm text-red-400">
                    {botStatus.message}
                  </p>
                )}
                <button
                  onClick={() => setBotStatus({ kind: "shared_fallback" })}
                  className="mt-3 text-xs text-paper-dim underline"
                >
                  Skip — use shared dev bot for testing
                </button>
              </>
            )}
          </div>

          <button
            onClick={deploy}
            disabled={busy || botStatus.kind === "idle"}
            className="mt-6 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Deploying..." : "Deploy Maya"}
          </button>
        </section>
      )}

      {stage === "deploy" && (
        <section className="border border-paper bg-ink-2 p-6">
          <h2 className="mb-3 font-display text-2xl">Maya deployment started</h2>
          <p className="text-paper-dim">{deployResult}</p>
          <p className="mt-4 text-sm text-paper-dim">
            She&apos;ll text you on Telegram shortly. Everything she finds —
            your research, the week&apos;s posts and replies, and what she&apos;s
            working on right now — also lives in Mission Control.
          </p>
          <div className="mt-5 rounded-lg border border-paper/15 bg-ink-3 p-4">
            <p className="font-display text-lg">One last thing: connect your calendar</p>
            <p className="mt-1 text-sm text-paper-dim">
              Maya drops each post and reply onto your Google Calendar at the
              right time, with the draft and a one-tap link. Connect it now so
              the week&apos;s plan lands where you&apos;ll see it.
            </p>
            <a
              href="/api/google-calendar-gtm/start"
              className="mt-3 inline-block rounded-lg bg-lime px-4 py-2 font-mono text-xs uppercase tracking-wide text-white"
            >
              Connect Google Calendar →
            </a>
          </div>
          <Link
            href="/clawlaunch/mission"
            className="mt-4 inline-block rounded-lg border border-paper px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper"
          >
            Open Mission Control →
          </Link>
        </section>
      )}
    </Shell>
  );
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Convert any thrown error into a safe, plain-language message for the operator.
 * Raw Convex / internal errors (e.g. "signed-in user required") are NEVER shown
 * on screen — they're logged to the console for debugging and mapped to friendly
 * copy here. Add specific cases as real ones come up; everything else falls back
 * to a generic try-again message.
 */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Keep the real error in the console so we can still debug.
  console.error("[onboarding]", raw);
  const lower = raw.toLowerCase();
  if (
    lower.includes("signed-in user required") ||
    lower.includes("authenticat") ||
    lower.includes("identity") ||
    lower.includes("unauthenticated")
  ) {
    return "We lost your sign-in for a second. Refresh the page and you'll pick up right where you left off.";
  }
  if (lower.includes("upload")) {
    return "That file didn't upload. Check it and try again.";
  }
  return "Something went wrong on our end. Give it another try in a moment.";
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main data-surface="onboarding" className="min-h-screen bg-ink text-paper">
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
              ? "bg-lime p-3 text-sm text-white"
              : "border border-paper bg-ink-2 p-3 text-sm text-paper-faint"
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
    <label className="flex items-center justify-between border border-paper bg-ink-2 p-4 text-sm">
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
