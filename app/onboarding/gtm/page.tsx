"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { selectActiveChannels } from "@/convex/gtmMaya/channelSelection";
import type { GtmChannelDecision } from "@/convex/gtmMaya/channelScoring";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";

type Stage = "intake" | "research" | "deploy";

// Per-channel warmth state captured at onboarding. Mirrors the
// tiktokWarmupState arc generalized to every channel: a brand-new
// account needs warming before it can post links; an established one
// can post straight away. Kept deliberately coarse (3 buckets) so the
// dropdown reads in one glance and never turns onboarding into a form.
type WarmthState = "new" | "warming" | "established";

// Connectable channels that have a handle field in the intake form.
// We only ask for warmth on channels the founder actually connected,
// so the section stays empty (zero friction) for the common case.
const WARMTH_CHANNELS = ["tiktok", "instagram", "youtube", "linkedin"] as const;
type WarmthChannel = (typeof WARMTH_CHANNELS)[number];

interface ChannelWarmth {
  state: WarmthState;
  // Optional age hint (days) — pre-fillable from a future ScrapeCreators
  // pull; the founder just confirms. Free-text numeric, may be "".
  accountAgeDays: string;
}

interface IntakeDraft {
  name: string;
  url: string;
  // Web app (a site) vs mobile app (an App Store / Play listing). Mobile
  // surfaces the store-URL fields + leans on screenshots as the slideshow
  // ground truth; web just uses `url`.
  appType: "web" | "mobile";
  appStoreUrl: string;
  playStoreUrl: string;
  // What counts as a customer + where they land — so Maya can close the
  // attribution loop on the signup side (clicks are already tracked).
  conversionKind: "signup" | "install" | "waitlist" | "demo" | "purchase";
  signupUrl: string;
  differentiator: string;
  founderWhy: string;
  stage: "idea" | "live-beta" | "paid" | "unknown";
  entryMode: "launch" | "manager";
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
  // Ground-truth signal for stage-adaptive strategy — a 5-user and a
  // 5000-user "paid" founder need very different plans.
  userCountBand: "none" | "1-100" | "100-1k" | "1k+" | "unknown";
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
  // Generalized per-channel warmth — one coarse arc per channel the
  // founder connected. TikTok still maps back to the legacy
  // tiktokWarmupState/tiktokAccountAgeDays fields on save (back-compat);
  // every channel's warmth is also serialized into channelWarmthJson so
  // the daily/weekly crons can read + advance the arc per channel.
  channelWarmth: Partial<Record<WarmthChannel, ChannelWarmth>>;
  openToUgcCreators: boolean;
  creatorBudgetMonthlyUsd: string;
  maxWeeklyVisualPosts: string;
  excludedAudiences: string;
}

// Founder-facing display names for scored channels. Keeps the picker
// from dumping raw enum values (e.g. "x" lowercase, "product_hunt").
const CHANNEL_LABELS: Record<string, string> = {
  reddit: "Reddit",
  x: "X",
  hn: "Hacker News",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

// Channels we no longer score or surface (vestigial — not in the
// product vision). YouTube is now a first-class Brief-only channel and
// is NO LONGER hidden; only product_hunt stays filtered out so stale
// historical rows can never resurface it.
const HIDDEN_CHANNELS = new Set(["product_hunt"]);

const DEFAULT_DRAFT: IntakeDraft = {
  name: "",
  url: "",
  appType: "web",
  appStoreUrl: "",
  playStoreUrl: "",
  conversionKind: "signup",
  signupUrl: "",
  differentiator: "",
  founderWhy: "",
  stage: "live-beta",
  entryMode: "manager",
  weekGoal: "signups",
  userCountBand: "none",
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
  channelWarmth: {},
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
  // S3 — operator confirms/overrides the channel recommendation before deploy.
  const setChannelDecisions = useMutation(
    api.gtmMaya.researchLifecycle.setMyChannelDecisions
  );

  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_DRAFT);
  const [walkthroughFile, setWalkthroughFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("intake");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [researchJobId, setResearchJobId] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<string | null>(null);
  // S3 — operator overrides to the channel recommendation (channel → decision).
  // Effective decision in render = override ?? the agent's scored decision.
  const [channelPicks, setChannelPicks] = useState<Record<string, string>>({});
  const [channelsConfirmed, setChannelsConfirmed] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);
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
      // Derive the legacy TikTok warmth fields from the generalized
      // per-channel warmth map so the existing setAppProfile contract +
      // deploy thresholds keep working unchanged. The full per-channel
      // map (channelWarmthJson) is reconstructed server-side at deploy
      // from the connected handle URLs + the ScrapeCreators pull.
      const tiktokWarmth = draft.channelWarmth.tiktok;
      const tiktokWarmupState: IntakeDraft["tiktokWarmupState"] = tiktokWarmth
        ? toTiktokWarmupState(tiktokWarmth.state)
        : "unknown";
      const tiktokAccountAgeDays = tiktokWarmth?.accountAgeDays ?? "";
      const appId = await setAppProfile({
        name: draft.name.trim(),
        url: draft.url.trim(),
        appType: draft.appType,
        appStoreUrl:
          draft.appType === "mobile"
            ? emptyToUndefined(draft.appStoreUrl)
            : undefined,
        playStoreUrl:
          draft.appType === "mobile"
            ? emptyToUndefined(draft.playStoreUrl)
            : undefined,
        conversionKind: draft.conversionKind,
        signupUrl: emptyToUndefined(draft.signupUrl),
        differentiator: draft.differentiator.trim() || undefined,
        founderWhy: draft.founderWhy.trim() || undefined,
        stage: draft.stage,
        entryMode: draft.entryMode,
        weekGoal: draft.weekGoal,
        userCountBand: draft.userCountBand,
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
        tiktokWarmupState,
        tiktokAccountAgeDays: numberOrUndefined(tiktokAccountAgeDays),
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
      // Capture the founder-confirmed per-channel warmth alongside
      // submission. Deploy reconstructs the authoritative channelWarmthJson
      // server-side (from connected handles + the ScrapeCreators pull); this
      // surfaces what the founder explicitly told us so it's observable.
      const channelWarmthJson = buildChannelWarmthJson(draft);
      track(ANALYTICS_EVENTS.ONBOARDING_SUBMITTED, {
        app_id: String(appId),
        connected_channels: connectedWarmthChannels(draft),
        ...(channelWarmthJson ? { channel_warmth_json: channelWarmthJson } : {}),
      });
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

  async function confirmChannels() {
    if (!snapshot) return;
    setSavingChannels(true);
    setError(null);
    try {
      const decisions = snapshot.channelScores.map((s) => ({
        channel: s.channel,
        decision: (channelPicks[s.channel] ?? s.decision) as
          | "primary"
          | "secondary"
          | "parked"
          | "blocked",
      }));
      await setChannelDecisions({ decisions });
      setChannelsConfirmed(true);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSavingChannels(false);
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
      if (result.ok) {
        track(ANALYTICS_EVENTS.PLAN_READY, { fly_app_id: result.flyAppId });
        setStage("deploy");
      }
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
          Set up Maya
        </p>
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Give Maya your product. She&apos;ll go get you customers.
        </h1>
        <p className="mt-5 max-w-2xl text-paper-dim">
          Two minutes here. Then Maya researches your market — who buys, where
          they are, what&apos;s working — and starts running your social:
          posting, replying, and reporting back every day.
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
              placeholder="Your app's name"
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
          <Field label="What kind of app is it?">
            <select
              value={draft.appType}
              onChange={(event) =>
                setDraft((d) => ({
                  ...d,
                  appType: event.target.value as IntakeDraft["appType"],
                }))
              }
              className="input"
            >
              <option value="web">Web app — people use it in a browser</option>
              <option value="mobile">
                Mobile app — people download it from the App Store / Play
              </option>
            </select>
          </Field>
          {draft.appType === "mobile" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="App Store URL (optional)">
                <input
                  value={draft.appStoreUrl}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, appStoreUrl: event.target.value }))
                  }
                  className="input"
                  placeholder="https://apps.apple.com/..."
                />
              </Field>
              <Field label="Play Store URL (optional)">
                <input
                  value={draft.playStoreUrl}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, playStoreUrl: event.target.value }))
                  }
                  className="input"
                  placeholder="https://play.google.com/..."
                />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What counts as a customer?">
              <select
                value={draft.conversionKind}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    conversionKind: event.target
                      .value as IntakeDraft["conversionKind"],
                  }))
                }
                className="input"
              >
                <option value="signup">A sign-up</option>
                <option value="install">An app install</option>
                <option value="waitlist">A waitlist join</option>
                <option value="demo">A demo booked</option>
                <option value="purchase">A purchase</option>
              </select>
            </Field>
            <Field label="Where do they land? (sign-up / install URL)">
              <input
                value={draft.signupUrl}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, signupUrl: event.target.value }))
                }
                className="input"
                placeholder="https://… (Maya tracks links to this so she can prove what converted)"
              />
            </Field>
          </div>
          <Field label="What does it do, and what makes it different?">
            <textarea
              value={draft.differentiator}
              onChange={(event) =>
                setDraft((d) => ({ ...d, differentiator: event.target.value }))
              }
              className="input min-h-28"
              placeholder="In your words: what it does, who it's for, and the one thing it does that the alternatives don't. This is what Maya anchors all your marketing on."
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
                I&apos;m live — take over my social and run it for me.
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
            <Field label="How many users/customers today?">
              <select
                value={draft.userCountBand}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    userCountBand: event.target
                      .value as IntakeDraft["userCountBand"],
                  }))
                }
                className="input"
              >
                <option value="none">none yet (pre-launch)</option>
                <option value="1-100">1–100</option>
                <option value="100-1k">100–1,000</option>
                <option value="1k+">1,000+</option>
                <option value="unknown">not sure</option>
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
              label="I'll connect Instagram so Maya posts for me"
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
          </div>

          {/* Per-channel warmth — only for channels the founder actually
              connected. Ban-safety is per channel: a brand-new account
              gets warmup-only days, an established one posts straight
              away. We keep this to one coarse dropdown (+ optional age)
              per connected channel so it never becomes a multi-step form;
              if you connected no handles, nothing renders. */}
          <ChannelWarmthSection draft={draft} setDraft={setDraft} />

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
            Here&apos;s where Maya thinks your buyers are — ranked, with the
            reasoning. This is her recommendation; you have the final call.
            Confirm it or change any channel before you deploy.
          </p>

          {/* S3 — channel-selection UX. Maya proposes with evidence; the
              operator confirms or overrides. All platforms are selectable —
              nothing is gated; the operator just focuses the set. The deploy
              reads decision === "primary"/"secondary" into the agent's GTM.md. */}
          {snapshot && snapshot.channelScores.length > 0 && (
            <div className="mt-6 border border-paper bg-ink p-5">
              <h3 className="mb-1 font-display text-lg">
                Where Maya wants to play
              </h3>
              <p className="mb-4 text-sm text-paper-dim">
                Ranked by buyer-fit. Set each to <strong>Primary</strong> (her
                main bet), <strong>Secondary</strong>, or <strong>Park</strong>{" "}
                (skip for now).
              </p>
              <div className="space-y-3">
                {[...snapshot.channelScores]
                  .filter((s) => !HIDDEN_CHANNELS.has(s.channel))
                  .sort((a, b) => b.score - a.score)
                  .map((s) => {
                    const pick = channelPicks[s.channel] ?? s.decision;
                    return (
                      <div
                        key={s.channel}
                        className="rounded border border-paper bg-ink-2 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-paper">
                              {CHANNEL_LABELS[s.channel] ??
                                s.channel.replace("_", " ")}
                            </span>
                            <span className="text-xs text-paper-dim">
                              {s.confidence} confidence
                            </span>
                          </div>
                          <select
                            value={pick}
                            disabled={channelsConfirmed}
                            onChange={(e) =>
                              setChannelPicks((prev) => ({
                                ...prev,
                                [s.channel]: e.target.value,
                              }))
                            }
                            className="input text-xs disabled:opacity-50"
                          >
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                            <option value="parked">Park</option>
                          </select>
                        </div>
                        {s.reasons.length > 0 && (
                          <p className="mt-2 text-sm text-paper-dim">
                            {s.reasons[0]}
                          </p>
                        )}
                        {s.risks.length > 0 && (
                          <p className="mt-1 text-xs text-amber-300/80">
                            Watch: {s.risks[0]}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
              {(() => {
                // Live preview of the activation policy: shows which channels
                // Maya will actually RUN given the current picks (lock all
                // high-fit, floor of 3). Same pure fn the deploy path uses, so
                // what the operator sees here is exactly what ships.
                const preview = selectActiveChannels(
                  snapshot.channelScores.map((s) => ({
                    channel: s.channel,
                    score: s.score,
                    decision: (channelPicks[s.channel] ??
                      s.decision) as GtmChannelDecision,
                    confidence: s.confidence,
                    qualityGate: s.qualityGate,
                  }))
                );
                if (preview.active.length === 0) return null;
                return (
                  <div className="mt-4 rounded border border-paper/40 bg-ink-2 p-3">
                    <p className="text-sm text-paper">
                      Maya will run{" "}
                      <strong>
                        {preview.active
                          .map((c) => CHANNEL_LABELS[c] ?? c)
                          .join(", ")}
                      </strong>
                      .
                    </p>
                    <p className="mt-1 text-xs text-paper-dim">{preview.note}</p>
                  </div>
                );
              })()}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={confirmChannels}
                  disabled={savingChannels}
                  className="rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingChannels
                    ? "Saving..."
                    : channelsConfirmed
                      ? "Channels confirmed ✓"
                      : "Confirm channels"}
                </button>
                {channelsConfirmed && (
                  <button
                    onClick={() => setChannelsConfirmed(false)}
                    className="text-xs text-paper-dim underline"
                  >
                    Change
                  </button>
                )}
              </div>
            </div>
          )}

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
            She&apos;ll text you on Telegram shortly with links to connect your
            channels. Tap each one, and from tomorrow morning Maya plans and
            posts your whole day for you. Everything — what&apos;s going out, what
            landed, how it performed, and your inbox — auto-updates in your HQ.
          </p>
          <Link
            href="/clawlaunch/mission"
            className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 font-mono text-xs uppercase tracking-wide text-white"
          >
            Open your HQ →
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

// Handle URL per warmth channel, so we only show warmth for channels the
// founder actually connected (sub-4-min onboarding — never ask about a
// channel with no account).
function handleUrlForChannel(draft: IntakeDraft, channel: WarmthChannel): string {
  switch (channel) {
    case "tiktok":
      return draft.existingTikTokUrl;
    case "instagram":
      return draft.existingInstagramUrl;
    case "youtube":
      return draft.existingYoutubeUrl;
    case "linkedin":
      return draft.existingLinkedinUrl;
  }
}

function connectedWarmthChannels(draft: IntakeDraft): WarmthChannel[] {
  return WARMTH_CHANNELS.filter(
    (channel) => handleUrlForChannel(draft, channel).trim().length > 0
  );
}

const WARMTH_LABELS: Record<WarmthState, string> = {
  new: "Brand new — needs warming up",
  warming: "Warming up — posting a bit",
  established: "Established — already active",
};

// Map the coarse onboarding warmth bucket onto the legacy
// tiktokWarmupState enum so the existing TikTok persistence + deploy
// thresholds keep working unchanged.
function toTiktokWarmupState(
  state: WarmthState
): IntakeDraft["tiktokWarmupState"] {
  switch (state) {
    case "new":
      return "new_needs_warmup";
    case "warming":
      return "warming";
    case "established":
      return "ready";
  }
}

// Serialize the per-channel warmth into the channelWarmthJson shape the
// crons read (keyed by channel, normalized to the warm/ready/new arc).
// Only connected channels are included. lastUpdatedMs lets the weekly
// cron tell a stale baseline from a fresh confirmation.
function buildChannelWarmthJson(draft: IntakeDraft): string | undefined {
  const channels = connectedWarmthChannels(draft);
  if (channels.length === 0) return undefined;
  const now = Date.now();
  const map: Record<
    string,
    { state: string; accountAgeDays?: number; lastUpdatedMs: number }
  > = {};
  for (const channel of channels) {
    const warmth = draft.channelWarmth[channel];
    if (!warmth) continue;
    const ageDays = numberOrUndefined(warmth.accountAgeDays);
    map[channel] = {
      state: toTiktokWarmupState(warmth.state),
      ...(ageDays !== undefined ? { accountAgeDays: ageDays } : {}),
      lastUpdatedMs: now,
    };
  }
  return Object.keys(map).length > 0 ? JSON.stringify(map) : undefined;
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
        <header className="mb-10 flex items-center">
          <Link href="/" className="font-mono text-xs uppercase tracking-widest">
            HeyMaya
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

/**
 * Lightweight per-channel warmth capture. Renders ONE coarse dropdown
 * (+ optional age hint) per channel the founder actually connected — and
 * nothing at all when no handles are entered. This generalizes the old
 * TikTok-only warmup question to every channel without turning onboarding
 * into a multi-step form: it's a single conditional block, defaulting to
 * "new" so the ban-safe path is the default.
 */
function ChannelWarmthSection({
  draft,
  setDraft,
}: {
  draft: IntakeDraft;
  setDraft: React.Dispatch<React.SetStateAction<IntakeDraft>>;
}) {
  const connected = connectedWarmthChannels(draft);
  if (connected.length === 0) return null;

  function updateWarmth(
    channel: WarmthChannel,
    patch: Partial<ChannelWarmth>
  ) {
    setDraft((d) => {
      const current: ChannelWarmth = d.channelWarmth[channel] ?? {
        state: "new",
        accountAgeDays: "",
      };
      return {
        ...d,
        channelWarmth: {
          ...d.channelWarmth,
          [channel]: { ...current, ...patch },
        },
      };
    });
  }

  return (
    <div className="border border-paper bg-ink-2 p-4">
      <p className="mb-1 text-sm font-medium text-paper">
        How warm are these accounts?
      </p>
      <p className="mb-4 text-xs text-paper-dim">
        Maya keeps you ban-safe: brand-new accounts get warmed up before
        they post links; established ones post right away. Just confirm
        where each connected account stands.
      </p>
      <div className="space-y-3">
        {connected.map((channel) => {
          const warmth: ChannelWarmth = draft.channelWarmth[channel] ?? {
            state: "new",
            accountAgeDays: "",
          };
          return (
            <div
              key={channel}
              className="grid gap-3 sm:grid-cols-2 sm:items-end"
            >
              <Field label={`${CHANNEL_LABELS[channel] ?? channel} status`}>
                <select
                  value={warmth.state}
                  onChange={(event) =>
                    updateWarmth(channel, {
                      state: event.target.value as WarmthState,
                    })
                  }
                  className="input"
                >
                  {(["new", "warming", "established"] as WarmthState[]).map(
                    (state) => (
                      <option key={state} value={state}>
                        {WARMTH_LABELS[state]}
                      </option>
                    )
                  )}
                </select>
              </Field>
              <Field label="Account age in days (optional)">
                <input
                  value={warmth.accountAgeDays}
                  onChange={(event) =>
                    updateWarmth(channel, {
                      accountAgeDays: event.target.value,
                    })
                  }
                  className="input"
                  inputMode="numeric"
                  placeholder="e.g. 30"
                />
              </Field>
            </div>
          );
        })}
      </div>
    </div>
  );
}
