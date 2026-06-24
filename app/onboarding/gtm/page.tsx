"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { planFeaturesGtm } from "@/convex/gtmMaya/planGtm";
import { track, ANALYTICS_EVENTS } from "@/lib/analytics";
import {
  TierSelector,
  type GtmTier,
  type GtmInterval,
} from "@/components/billing/TierSelector";

// Onboarding is three clean steps: Product → Plan → Connect. Maya does ALL her
// own market/channel research natively in her BOOT turn after deploy — Convex no
// longer pre-runs research or makes the founder rank "buyer fit" up front.
// "deploy" is the terminal success beat (auto-redirects into the HQ).
type Stage = "intake" | "plan" | "connect" | "deploy";

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
  // W4 — X (Twitter) is one of Maya's PRIMARY posting channels, but voice
  // extraction ran blind there with no handle to read. Capturing it lets
  // Phase-0 voice grounding sample the founder's real X posts.
  existingXUrl: string;
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
  existingXUrl: "",
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
  const inspectApp = useAction(api.gtmMaya.appInspector.inspectMyGtmApp);
  const analyzeWalkthrough = useAction(
    api.gtmMaya.walkthrough.analyzeMyWalkthroughUpload
  );
  const deployMaya = useAction(api.onboarding.gtm.deployMayaGtm.runMyGtmDeploy);
  // Sprint 2.26b — operator pastes their personal Telegram bot token
  // (from BotFather). Action validates via getMe, encrypts, stores on
  // gtmAgents row, then deploy reads it back via internal query.
  // Shared-Maya-bot pairing. `createPairingToken` mints a single-use deep link
  // to @Maya; `getMyPairingStatus` is reactive so the Connect step advances the
  // moment the founder presses Start in Telegram (the webhook claims the token).
  const createPairingToken = useMutation(
    api.gtmMaya.telegramPairing.createPairingToken
  );
  const pairingStatus = useQuery(api.gtmMaya.telegramPairing.getMyPairingStatus);
  // Tier selection → Stripe checkout. Picking a plan starts the 7-day trial;
  // the webhook grants the trialing plan (so planFeaturesGtm flips from the
  // fail-closed maxActiveChannels:0 default to the chosen tier's caps) on the
  // founder's return to the app. This is the funnel step that turns a fresh
  // signup into a payer — without it gtmPlanJson stays unset and Maya can
  // research/draft but never POST.
  const startCheckout = useAction(
    api.billing.gtmBilling.createGtmCheckoutSession
  );

  const [draft, setDraft] = useState<IntakeDraft>(DEFAULT_DRAFT);
  const [walkthroughFile, setWalkthroughFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("intake");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Dedicated flag for the Fly-provision deploy (~30-60s) so we can show a
  // clear full-screen spinner instead of just flipping a button label — and
  // keep it up right through the auto-redirect into the HQ.
  const [deploying, setDeploying] = useState(false);
  // Tier-selection state. `interval` toggles monthly/annual; `checkoutTier`
  // marks the card mid-redirect so it shows a pending state.
  const [billingInterval, setBillingInterval] =
    useState<GtmInterval>("monthly");
  const [checkoutTier, setCheckoutTier] = useState<GtmTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // The minted pairing deep link (+ bot username) for the Connect step.
  const [pairing, setPairing] = useState<{
    deepLink: string;
    botUsername: string;
  } | null>(null);

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

  // Once Maya is deployed, drop the founder straight into their HQ. We hold a
  // brief "she's live" beat (so the success registers) then push to the mission
  // dashboard, which hydrates live via Convex subscriptions. The spinner stays
  // up the whole time so there's never a blank or "is it stuck?" moment.
  useEffect(() => {
    if (stage !== "deploy") return;
    const t = setTimeout(() => {
      // Hard navigation (matches the Stripe-checkout redirect pattern above) —
      // the mission dashboard then hydrates live via Convex subscriptions.
      window.location.href = "/clawlaunch/mission";
    }, 2600);
    return () => clearTimeout(t);
  }, [stage]);

  // Mint the Telegram pairing deep link when the founder reaches the Connect
  // step (and isn't already paired). Idempotent server-side — a refresh reuses
  // the live token rather than minting a new one.
  useEffect(() => {
    if (stage !== "connect") return;
    if (pairing || pairingStatus?.paired) return;
    let cancelled = false;
    void createPairingToken({})
      .then((res) => {
        if (!cancelled) {
          setPairing({ deepLink: res.deepLink, botUsername: res.botUsername });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [stage, pairing, pairingStatus?.paired, createPairingToken]);

  const canSubmit = useMemo(() => {
    // W1.3 — a mobile-only founder with no landing page can submit with just a
    // store link; the store listing becomes Maya's product-context source.
    const hasWebUrl = draft.url.trim().startsWith("http");
    const hasStoreUrl =
      draft.appType === "mobile" &&
      (draft.appStoreUrl.trim().startsWith("http") ||
        draft.playStoreUrl.trim().startsWith("http"));
    // W4 — the differentiator is THE anchor for every research worker + draft;
    // make it confirm-required so Maya never has to guess the product's wedge.
    return (
      (hasWebUrl || hasStoreUrl) &&
      draft.name.trim().length > 0 &&
      draft.differentiator.trim().length > 0
    );
  }, [
    draft.name,
    draft.url,
    draft.appType,
    draft.appStoreUrl,
    draft.playStoreUrl,
    draft.differentiator,
  ]);

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
      // W1.3 — when a mobile founder has no website, fall back to the store
      // link as the app `url` (gtmApps.url is required; the inspector detects
      // the store URL and reads the listing instead of crawling a dead site).
      const webUrl = draft.url.trim();
      const effectiveUrl = webUrl.startsWith("http")
        ? webUrl
        : draft.appStoreUrl.trim().startsWith("http")
          ? draft.appStoreUrl.trim()
          : draft.playStoreUrl.trim();
      const appId = await setAppProfile({
        name: draft.name.trim(),
        url: effectiveUrl,
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
        existingXUrl: emptyToUndefined(draft.existingXUrl),
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
      // NOTE: Maya owns her market + channel research natively in her BOOT turn
      // after deploy — Convex no longer pre-runs a research job here or asks the
      // founder to rank channels. Onboarding just captures the product + plan +
      // bot; `appInspector` above gives the product picture, and the rest is hers.
      const channelWarmthJson = buildChannelWarmthJson(draft);
      track(ANALYTICS_EVENTS.ONBOARDING_SUBMITTED, {
        app_id: String(appId),
        connected_channels: connectedWarmthChannels(draft),
        ...(channelWarmthJson ? { channel_warmth_json: channelWarmthJson } : {}),
      });
      setStage("connect");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseTier(tier: GtmTier, interval: GtmInterval) {
    setCheckoutTier(tier);
    setCheckoutError(null);
    try {
      track(ANALYTICS_EVENTS.CHECKOUT_STARTED, { tier, interval });
      const { url } = await startCheckout({ tier, interval });
      // Hard redirect to Stripe Checkout. On return, the webhook has granted
      // the trialing plan; the founder lands back in the app ready to deploy.
      window.location.href = url;
    } catch (err) {
      setCheckoutError(friendlyError(err));
      setCheckoutTier(null);
    }
  }

  async function deploy() {
    setDeploying(true);
    setError(null);
    try {
      const result = await deployMaya({});
      if (result.ok) {
        track(ANALYTICS_EVENTS.PLAN_READY, { fly_app_id: result.flyAppId });
        // Move to the "live" beat; the redirect effect below drops the founder
        // into their HQ. Keep `deploying` true so the spinner never flickers
        // off between the deploy resolving and the dashboard loading.
        setStage("deploy");
      } else {
        // Non-ok deploy → surface the reason, drop the spinner so they can retry.
        setError(`${result.stage}: ${result.message}`);
        setDeploying(false);
      }
    } catch (err) {
      setError(friendlyError(err));
      setDeploying(false);
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
          <Field
            label={
              draft.appType === "mobile"
                ? "Product URL (optional — add your store link below)"
                : "Product URL"
            }
          >
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
          <Field label="What does it do, and what makes it different? (required — Maya anchors everything on this)">
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
          <Field label="Walkthrough recording — your single best accuracy signal (any app type)">
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
            <Field label="X (Twitter) profile, if any">
              <input
                value={draft.existingXUrl}
                onChange={(event) =>
                  setDraft((d) => ({
                    ...d,
                    existingXUrl: event.target.value,
                  }))
                }
                className="input"
                placeholder="https://x.com/..."
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
            className="inline-flex items-center gap-2 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner className="text-ink" /> Reading your product…
              </>
            ) : (
              "Start research"
            )}
          </button>
        </section>
      )}

      {/* STEP 2 — Connect Maya on Telegram (the shared Maya bot). The founder
          opens @Maya and presses Start; the webhook claims the pairing token and
          this screen advances automatically (getMyPairingStatus is reactive). */}
      {stage === "connect" && (
        <section className="border border-paper bg-ink-2 p-6">
          <h2 className="mb-2 font-display text-2xl">Connect Maya on Telegram</h2>
          <p className="mb-6 max-w-xl text-sm text-paper-dim">
            Maya lives in your texts. Connect Telegram and she&apos;ll message you
            there — your daily plan, what she posted, what landed, and your
            questions answered, all in one chat.
          </p>

          {pairingStatus?.paired ? (
            <div className="rounded border border-lime/40 bg-ink p-5">
              <p className="text-sm text-paper">
                ✓ Connected
                {pairingStatus.username ? (
                  <>
                    {" "}
                    as{" "}
                    <span className="font-mono">@{pairingStatus.username}</span>
                  </>
                ) : null}
                . Maya can text you now.
              </p>
              <button
                onClick={() => setStage("plan")}
                className="mt-5 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink"
              >
                Continue →
              </button>
            </div>
          ) : (
            <div className="border border-paper bg-ink p-5">
              <ol className="space-y-4 text-sm text-paper-dim">
                <li>
                  <span className="font-medium text-paper">1. Get Telegram</span>{" "}
                  — a free messaging app.{" "}
                  <a
                    className="underline"
                    href="https://telegram.org/dl"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download it here
                  </a>{" "}
                  if you don&apos;t already have it.
                </li>
                <li>
                  <span className="font-medium text-paper">2. Open Maya</span> —
                  on this device, tap the button. On your phone, scan the QR.
                  {pairing ? (
                    <>
                      <div className="mt-3 flex flex-wrap items-center gap-5">
                        <a
                          href={pairing.deepLink}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink"
                        >
                          Open Maya in Telegram
                        </a>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt="Scan to open Maya in Telegram"
                          width={140}
                          height={140}
                          className="rounded bg-white p-1"
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                            pairing.deepLink
                          )}`}
                        />
                      </div>
                      <p className="mt-2 text-xs text-paper-faint">
                        Or search{" "}
                        <span className="font-mono text-paper">
                          @{pairing.botUsername}
                        </span>{" "}
                        in Telegram and tap Start.
                      </p>
                    </>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 text-paper-dim">
                      <Spinner className="text-lime" /> Preparing your link…
                    </div>
                  )}
                </li>
                <li>
                  <span className="font-medium text-paper">3. Press Start</span>{" "}
                  in the chat with Maya — this screen updates automatically the
                  moment you&apos;re linked.
                </li>
              </ol>
              <div className="mt-5 flex items-center gap-2 text-sm text-paper-dim">
                <Spinner className="text-lime" /> Waiting for you to open Maya and
                press Start…
              </div>
            </div>
          )}
        </section>
      )}

      {/* STEP 3 — Pick a plan (LAST), then launch. For a comped/active account
          we confirm the plan and go straight to launch; otherwise the founder
          picks a tier (→ Stripe) here. Deploy is the final action. */}
      {stage === "plan" && (
        <section className="border border-paper bg-ink-2 p-6">
          {(() => {
            const pf = snapshot
              ? planFeaturesGtm({ gtmPlanJson: snapshot.agent.gtmPlanJson })
              : null;
            const planActive =
              !!pf && pf.status !== "none" && pf.maxActiveChannels > 0;
            if (!planActive || !pf) return null;
            const tierName =
              pf.plan.charAt(0).toUpperCase() + pf.plan.slice(1);
            return (
              <div className="mb-4 rounded border border-lime/40 bg-ink p-4 text-sm text-paper">
                You&apos;re on <strong>{tierName}</strong> — you&apos;re all set.
                Launch Maya below.
              </div>
            );
          })()}

          <div className="border border-paper bg-ink p-5">
            <h3 className="mb-2 font-display text-lg">Pick your plan</h3>
            <p className="mb-4 text-sm text-paper-dim">
              Start your 7-day free trial so Maya can go live and start posting
              for you. Cancel any time before it ends and you won&apos;t be
              charged. More channels (and Maya making your videos) unlock as you
              go up.
            </p>
            <TierSelector
              interval={billingInterval}
              onIntervalChange={setBillingInterval}
              busyTier={checkoutTier}
              onSelect={chooseTier}
            />
            {checkoutError ? (
              <p className="mt-3 text-sm text-red-400">{checkoutError}</p>
            ) : null}
          </div>

          <button
            onClick={deploy}
            disabled={deploying}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deploying ? (
              <>
                <Spinner className="text-ink" /> Launching…
              </>
            ) : (
              "Launch Maya"
            )}
          </button>
        </section>
      )}

      {stage === "deploy" && (
        <section className="flex flex-col items-center justify-center border border-paper bg-ink-2 p-10 text-center">
          <Spinner className="mb-5 size-8 text-lime" />
          <h2 className="mb-2 font-display text-2xl">Maya&apos;s live ✓</h2>
          <p className="text-sm text-paper-dim">
            Opening your HQ — everything she does, live…
          </p>
          <Link
            href="/clawlaunch/mission"
            className="mt-6 inline-block rounded-lg bg-lime px-4 py-2 font-mono text-xs uppercase tracking-wide text-white"
          >
            Open your HQ →
          </Link>
        </section>
      )}

      {/* Full-screen deploy spinner — the Fly provision takes ~30-60s, so we
          cover the page with a clear, reassuring loader (never a frozen-looking
          button) and hold it right through the redirect into the HQ. */}
      {deploying && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/95 px-6 text-center backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <Spinner className="size-10 text-lime" />
          <h2 className="mt-6 font-display text-2xl text-paper">
            Setting up your Maya…
          </h2>
          <p className="mt-3 max-w-sm text-sm text-paper-dim">
            Provisioning her workspace and bringing her online. This takes about
            a minute — hang tight, we&apos;ll drop you straight into your HQ.
          </p>
        </div>
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
  // Three founder-facing steps flowed across the top. "deploy" is the terminal
  // success beat — it keeps the final "Connect" step lit (all done).
  const steps: { key: Stage; label: string }[] = [
    { key: "intake", label: "Product" },
    { key: "connect", label: "Connect" },
    { key: "plan", label: "Plan" },
  ];
  const order: Stage[] = ["intake", "connect", "plan", "deploy"];
  const current = order.indexOf(stage);
  return (
    <div className="mb-10 grid gap-3 sm:grid-cols-3">
      {steps.map((step) => {
        const reached = current >= order.indexOf(step.key);
        return (
          <div
            key={step.key}
            className={
              reached
                ? "bg-lime p-3 text-sm text-white"
                : "border border-paper bg-ink-2 p-3 text-sm text-paper-faint"
            }
          >
            {step.label}
          </div>
        );
      })}
    </div>
  );
}

// Inline spinner — a spinning ring drawn with current text color, so callers
// size + tint it via className (e.g. `size-8 text-lime`). No dependency, no
// asset; just CSS animation. Defaults to a button-sized 1rem ring.
function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
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
