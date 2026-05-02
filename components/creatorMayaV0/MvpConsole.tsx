"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquareText,
  Play,
  Radar,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
} from "lucide-react";

type RunState = "idle" | "running" | "ready" | "error";
type BusyKey =
  | "account"
  | "tiktok"
  | "calendar"
  | "intake"
  | "phone"
  | "deploy"
  | "pair"
  | "demo"
  | "brand"
  | null;

const TZ =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "America/New_York";

type SetupStep = "account" | "tiktok" | "calendar" | "picture" | "phone" | "done";
const SETUP_STEP_STORAGE_KEY = "creatorMayaV0.currentStep";

const SETUP_STEPS: Array<{ key: SetupStep; label: string }> = [
  { key: "account", label: "Account" },
  { key: "tiktok", label: "TikTok" },
  { key: "calendar", label: "Calendar" },
  { key: "picture", label: "Creator picture" },
  { key: "phone", label: "Phone" },
  { key: "done", label: "Handoff" },
];

function isSetupStep(step: string | null): step is SetupStep {
  return SETUP_STEPS.some((candidate) => candidate.key === step);
}

export function CreatorMayaV0Onboarding() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useQuery(api.creatorMayaV0.backend.state);
  const getOrCreate = useMutation(api.creatorMayaV0.backend.getOrCreateAccount);
  const connectCalendar = useMutation(api.creatorMayaV0.backend.connectCalendarProvider);
  const disconnectCalendar = useMutation(
    api.creatorMayaV0.backend.disconnectCalendarProvider
  );
  const submitIntake = useMutation(api.creatorMayaV0.backend.submitIntake);
  const confirmReadback = useMutation(api.creatorMayaV0.backend.confirmReadback);
  const collectPhone = useMutation(api.creatorMayaV0.backend.collectPhoneForNativePairing);
  const deployOpenClaw = useMutation(api.creatorMayaV0.backend.deployOpenClaw);
  const deployOpenClawLive = useAction(api.creatorMayaV0.backend.deployOpenClawLive);
  const connectTikTokLive = useAction(
    api.creatorMayaV0.backend.connectTikTokWithScrapeCreators
  );

  const [busy, setBusy] = useState<BusyKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedStep, setSavedStep] = useState<SetupStep | null>(null);
  const [manualStep, setManualStep] = useState<SetupStep | null>(null);
  const [device, setDevice] = useState<"desktop" | "ios" | "android">("desktop");
  const [handle, setHandle] = useState(state?.tiktok?.handle ?? "");
  const [phone, setPhone] = useState(state?.creator?.phoneNumber ?? "");
  const [goal, setGoal] = useState(state?.picture?.goal ?? "");
  const [blocker, setBlocker] = useState("");
  const [nicheCorrection, setNicheCorrection] = useState(
    state?.picture?.niche ?? ""
  );
  const [weeklyHours, setWeeklyHours] = useState(4);

  const email = user?.primaryEmailAddress?.emailAddress ?? "creator@example.com";
  const signedIn = Boolean(user);
  const sanitizedHandle = handle.replace(/^@/, "").trim();
  const accountReady = Boolean(state?.creator);
  const tiktokConnected = Boolean(state?.tiktok);
  const calendarConnected = state?.calendar?.status === "active";
  const phoneCollected = Boolean(state?.creator?.phoneNumber);
  const pictureReady = Boolean(state?.picture);
  const calendarEventCount = state?.calendarEvents?.length ?? 0;
  const latestDeployment = state?.latestDeployment;
  const liveOpenClawRequested =
    searchParams.get("liveOpenClaw") === "1" ||
    process.env.NEXT_PUBLIC_CREATOR_MAYA_LIVE_OPENCLAW === "true";
  const showLiveOpenClawControl =
    liveOpenClawRequested || process.env.NODE_ENV !== "production";
  const setupComplete =
    accountReady && tiktokConnected && calendarConnected && pictureReady && phoneCollected;
  const recommendedStep = setupComplete
    ? "done"
    : !accountReady
      ? "account"
      : !tiktokConnected
        ? "tiktok"
        : !calendarConnected
          ? "calendar"
          : !pictureReady
            ? "picture"
            : !phoneCollected
              ? "phone"
              : "done";
  const requestedStep = searchParams.get("step");
  const urlStep = isSetupStep(requestedStep) ? requestedStep : null;
  const desiredStep = manualStep ?? urlStep ?? savedStep ?? recommendedStep;
  const recommendedStepIndex = SETUP_STEPS.findIndex(
    (step) => step.key === recommendedStep
  );
  const desiredStepIndex = SETUP_STEPS.findIndex((step) => step.key === desiredStep);
  const stateLoaded = state !== undefined;
  const activeStep =
    signedIn &&
    stateLoaded &&
    desiredStepIndex > recommendedStepIndex &&
    recommendedStep !== "done"
      ? recommendedStep
      : desiredStep;
  const activeStepIndex = SETUP_STEPS.findIndex((step) => step.key === activeStep);
  const previousStep = SETUP_STEPS[activeStepIndex - 1]?.key ?? null;

  function rememberStep(step: SetupStep) {
    setSavedStep(step);
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(SETUP_STEP_STORAGE_KEY, step);
    }
  }

  function goToStep(step: SetupStep) {
    setManualStep(step);
    rememberStep(step);
    const next = new URLSearchParams(searchParams.toString());
    next.set("step", step);
    next.delete("googleCalendar");
    next.delete("error");
    next.delete("imported");
    router.replace(`/creator-maya-v0?${next.toString()}`);
  }

  function goBack() {
    if (previousStep) goToStep(previousStep);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!window.localStorage) return;
      const stored = window.localStorage.getItem(SETUP_STEP_STORAGE_KEY);
      if (isSetupStep(stored)) setSavedStep(stored);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const ua = navigator.userAgent.toLowerCase();
      const platform = navigator.platform.toLowerCase();
      const touchMac = platform.includes("mac") && navigator.maxTouchPoints > 1;
      if (/iphone|ipad|ipod/.test(ua) || touchMac) setDevice("ios");
      else if (/android/.test(ua)) setDevice("android");
      else setDevice("desktop");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (state?.tiktok?.handle) setHandle((current) => current || state.tiktok!.handle);
      if (state?.creator?.phoneNumber) {
        setPhone((current) => current || state.creator!.phoneNumber!);
      }
      if (state?.picture?.goal) setGoal((current) => current || state.picture!.goal);
      if (state?.picture?.niche) {
        setNicheCorrection((current) => current || state.picture!.niche);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [state]);

  useEffect(() => {
    const googleCalendar = searchParams.get("googleCalendar");
    if (!googleCalendar) return;
    const timeout = window.setTimeout(() => {
      if (googleCalendar === "connected") {
        const imported = searchParams.get("imported") ?? "0";
        setNotice(`Google Calendar connected. Maya imported ${imported} lookahead events.`);
        rememberStep("picture");
        setManualStep("picture");
        router.replace("/creator-maya-v0?step=picture");
      } else if (googleCalendar === "error") {
        setError(stripStack(searchParams.get("error") ?? "Google Calendar failed"));
        rememberStep("calendar");
        setManualStep("calendar");
        router.replace("/creator-maya-v0?step=calendar");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams, router]);

  async function ensureAccount() {
    await getOrCreate({ email, timezone: TZ, tier: "starter" });
  }

  async function confirmAccount() {
    await runStep("account", async () => {
      await ensureAccount();
      goToStep("tiktok");
      setNotice("Account confirmed. Maya can now save setup progress as you go.");
    });
  }

  async function runStep(key: Exclude<BusyKey, null>, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(stripStack((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function saveCreatorProfile() {
    await runStep("intake", async () => {
      await ensureAccount();
      await submitIntake({
        ninetyDayGoal: goal || "grow a durable creator business",
        creatorStage: "growing_consistently",
        biggestBlocker: blocker || "inconsistent planning",
        weeklyHoursAvailable: weeklyHours,
        tone: "strategic",
        doNotSuggest: ["daily vlogs"],
      });
      await confirmReadback({
        corrections: {
          niche: nicheCorrection || "TikTok creator building a focused audience",
        },
      });
      goToStep("phone");
      setNotice("Creator picture saved. Maya now has your goals, niche, constraints, and working context.");
    });
  }

  async function connectTikTok() {
    await runStep("tiktok", async () => {
      await ensureAccount();
      await connectTikTokLive({ handle: sanitizedHandle });
      goToStep("calendar");
      setNotice(`TikTok connected for @${sanitizedHandle}. Maya will sample useful posts instead of watching everything.`);
    });
  }

  async function connectGoogleCalendar() {
    await runStep("calendar", async () => {
      await ensureAccount();
      rememberStep("calendar");
      window.location.assign("/api/google-calendar/start");
    });
  }

  async function connectApplePhoneCalendar() {
    await runStep("calendar", async () => {
      await ensureAccount();
      await connectCalendar({
        provider: "apple",
        providerMode: "apple_phone_api",
        timezone: TZ,
        lookaheadDays: 14,
        canCreateHolds: true,
      });
      goToStep("picture");
      setNotice("Apple Calendar selected. Maya will request phone-native permission after iMessage pairing.");
    });
  }

  async function disconnectCalendarAccess() {
    await runStep("calendar", async () => {
      await disconnectCalendar({});
      goToStep("calendar");
      setNotice("Calendar disconnected. Maya removed the stored connection and lookahead events.");
    });
  }

  async function savePhone() {
    await runStep("phone", async () => {
      await ensureAccount();
      await collectPhone({ phoneNumber: phone.trim() });
      const deployment = liveOpenClawRequested
        ? await deployLiveOpenClaw()
        : await deployOpenClaw({ mode: "mock" });
      goToStep("done");
      if (deployment.ok === true) {
        const label =
          "flyAppId" in deployment
            ? deployment.flyAppId
            : deployment.deployLabel;
        setNotice(`Phone saved. Maya's OpenClaw workspace is prepared: ${label}.`);
      } else {
        const blockers =
          "blockers" in deployment && Array.isArray(deployment.blockers)
            ? deployment.blockers.join(", ")
            : "unknown blocker";
        setError(
          `Phone saved, but Maya provisioning is blocked: ${blockers}.`
        );
      }
    });
  }

  async function startLiveOpenClawTest() {
    await runStep("deploy", async () => {
      const deployment = await deployLiveOpenClaw();
      if (deployment.ok === true) {
        setNotice(`Live OpenClaw is online on Fly: ${deployment.flyAppId}.`);
        return;
      }
      const blockers =
        "blockers" in deployment && Array.isArray(deployment.blockers)
          ? deployment.blockers.join(", ")
          : "error" in deployment
            ? deployment.error
            : "unknown blocker";
      setError(`Live OpenClaw deploy blocked: ${blockers}.`);
    });
  }

  async function deployLiveOpenClaw(): Promise<
    | {
        ok: true;
        mode: "live_test" | "production";
        flyAppId: string;
        machineId: string;
        machineState: string;
      }
    | { ok: false; blockers?: string[]; error?: string }
  > {
    return await deployOpenClawLive({ mode: "live_test", confirm: true });
  }

  function renderCurrentStep() {
    if (!signedIn) {
      return (
        <SetupPanel
          number="1"
          title="Create your account"
          action={
            <Link
              href="/sign-up?redirect_url=/creator-maya-v0?step=account"
              className="inline-flex min-h-10 items-center rounded-md bg-lime px-3 text-sm font-medium text-black transition hover:brightness-95"
            >
              Sign up
            </Link>
          }
        >
          <p className="text-sm leading-relaxed text-paper-dim">
            Sign up to start Maya setup.
          </p>
        </SetupPanel>
      );
    }

    if (activeStep === "account") {
      return (
        <SetupPanel
          number="1"
          title="Confirm your account"
          action={
            <button
              type="button"
              disabled={busy !== null}
              onClick={confirmAccount}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lime px-3 text-sm font-medium text-black disabled:opacity-60"
            >
              {busy === "account" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save and continue
            </button>
          }
        >
          <div className="flex items-center gap-4 rounded-md border border-[var(--hairline)] bg-ink p-4">
            {user?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.imageUrl}
                alt=""
                className="h-14 w-14 rounded-full border border-[var(--hairline-strong)] object-cover"
              />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-full bg-ink-3 text-lime">
                <UserRound className="h-6 w-6" />
              </span>
            )}
            <div>
              <p className="text-sm font-medium text-paper">
                {user?.fullName ?? user?.username ?? "Creator account"}
              </p>
              <p className="mt-1 text-sm text-paper-dim">{email}</p>
              <p className="mt-2 text-xs text-paper-faint">
                Maya will save each setup step to this account.
              </p>
            </div>
          </div>
        </SetupPanel>
      );
    }

    if (activeStep === "tiktok") {
      return (
        <SetupPanel
          number="2"
          title="Connect TikTok"
          action={
            tiktokConnected ? (
              <button
                type="button"
                onClick={() => goToStep("calendar")}
                className="inline-flex min-h-10 items-center rounded-md bg-paper px-3 text-sm font-medium text-ink"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null || !sanitizedHandle}
                onClick={connectTikTok}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lime px-3 text-sm font-medium text-black disabled:opacity-60"
              >
                {busy === "tiktok" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Connect
              </button>
            )
          }
        >
          {tiktokConnected ? (
            <ConnectedProfile
              avatarUrl={state?.tiktok?.avatarUrl}
              title={state?.tiktok?.displayName ?? `@${state?.tiktok?.handle}`}
              subtitle={`@${state?.tiktok?.handle} · ${formatNumber(state?.tiktok?.followerCount ?? 0)} followers`}
              body="TikTok connected. Maya can use profile context, metadata, and selected samples without pretending she watched every post."
            />
          ) : (
            <>
              <TextInput label="TikTok handle" value={handle} onChange={setHandle} />
              <p className="mt-3 text-xs leading-relaxed text-paper-faint">
                Maya will confirm the profile before moving on.
              </p>
            </>
          )}
        </SetupPanel>
      );
    }

    if (activeStep === "calendar") {
      return (
        <SetupPanel
          number="3"
          title="Connect your calendar"
          action={
            calendarConnected ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => goToStep("picture")}
                  className="inline-flex min-h-10 items-center rounded-md bg-paper px-3 text-sm font-medium text-ink"
                >
                  Continue
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={disconnectCalendarAccess}
                  className="inline-flex min-h-10 items-center rounded-md border border-rose/40 px-3 text-sm text-rose disabled:opacity-60"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={connectGoogleCalendar}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
                >
                  <ExternalLink className="h-4 w-4" />
                  Google Calendar
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={connectApplePhoneCalendar}
                  className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim disabled:opacity-60"
                >
                  Apple on iPhone
                </button>
              </div>
            )
          }
        >
          {calendarConnected ? (
            <div className="rounded-md border border-lime/25 bg-lime/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-lime">
                <CheckCircle2 className="h-4 w-4" />
                Calendar connected
              </p>
              <p className="mt-2 text-sm leading-relaxed text-paper-dim">
                Maya imported {calendarEventCount} lookahead events and will use
                them for planning content windows and holds after approval.
              </p>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-paper-dim">
              {device === "ios"
                ? "Maya can use Google here, or request Apple Calendar access from your iPhone after the iMessage handoff."
                : device === "android"
                  ? "Maya can use Google Calendar here; Apple Calendar stays on the iPhone handoff path."
                  : "Maya uses your calendar to plan around real life."}
            </p>
          )}
        </SetupPanel>
      );
    }

    if (activeStep === "picture") {
      return (
        <SetupPanel
          number="4"
          title="Build your creator picture"
          action={
            pictureReady ? (
              <button
                type="button"
                onClick={() => goToStep("phone")}
                className="inline-flex min-h-10 items-center rounded-md bg-paper px-3 text-sm font-medium text-ink"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={saveCreatorProfile}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
              >
                {busy === "intake" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Save picture
              </button>
            )
          }
        >
          {pictureReady ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Niche" value={state?.picture?.niche} />
              <Fact label="Goal" value={state?.picture?.goal} />
              <Fact label="Stage" value={state?.picture?.stage} />
              <Fact
                label="Confidence"
                value={`${Math.round((state?.picture?.confidence ?? 0) * 100)}%`}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="90-day goal" value={goal} onChange={setGoal} />
              <TextInput label="Biggest blocker" value={blocker} onChange={setBlocker} />
              <TextInput label="Niche" value={nicheCorrection} onChange={setNicheCorrection} />
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  Weekly creator hours
                </span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={weeklyHours}
                  onChange={(event) => setWeeklyHours(Number(event.target.value))}
                  className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-paper-dim"
                />
              </label>
            </div>
          )}
        </SetupPanel>
      );
    }

    if (activeStep === "phone") {
      return (
        <SetupPanel
          number="5"
          title="Where should Maya text you?"
          action={
            phoneCollected ? (
              <button
                type="button"
                onClick={() => goToStep("done")}
                className="inline-flex min-h-10 items-center rounded-md bg-paper px-3 text-sm font-medium text-ink"
              >
                Finish
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null || !phone.trim()}
                onClick={savePhone}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
              >
                {busy === "phone" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                Save phone
              </button>
            )
          }
        >
          {phoneCollected ? (
            <div className="rounded-md border border-lime/25 bg-lime/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-lime">
                <CheckCircle2 className="h-4 w-4" />
                Phone saved
              </p>
              <p className="mt-2 font-mono text-sm text-paper">{state?.creator?.phoneNumber}</p>
              <p className="mt-2 text-sm leading-relaxed text-paper-dim">
                Beta starts with iMessage. OpenClaw will bring Maya online and
                Maya will text this number.
              </p>
            </div>
          ) : (
            <>
              <TextInput label="Phone number" value={phone} onChange={setPhone} />
              <p className="mt-3 text-xs leading-relaxed text-paper-faint">
                iMessage only for beta.
              </p>
            </>
          )}
        </SetupPanel>
      );
    }

    return (
      <SetupPanel
        number="6"
        title="You're all set"
        action={
          <div className="flex flex-wrap gap-2">
            {showLiveOpenClawControl ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={startLiveOpenClawTest}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lime px-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "deploy" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {latestDeployment?.flyAppId ? "Redeploy OpenClaw" : "Live OpenClaw"}
              </button>
            ) : null}
            <Link
              href="/creator-maya-v0/debug"
              className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim transition hover:text-paper"
            >
              Status
            </Link>
          </div>
        }
      >
        <div className="rounded-md border border-lime/25 bg-lime/10 p-5">
          <p className="font-display text-3xl text-paper">
            You&apos;re all set. Maya will text you directly.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-paper-dim">
            Maya pulled your TikTok context, built your creator picture, saved
            your calendar path, and prepared the OpenClaw workspace.
          </p>
          {latestDeployment ? (
            <div className="mt-4 rounded-md border border-[var(--hairline)] bg-ink/60 p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                OpenClaw
              </p>
              <p className="mt-1 text-sm text-paper">
                {latestDeployment.status}
                {latestDeployment.deployLabel ? ` · ${latestDeployment.deployLabel}` : ""}
              </p>
              {latestDeployment.flyAppId ? (
                <p className="mt-2 font-mono text-xs text-paper-dim">
                  {latestDeployment.flyAppId}
                  {latestDeployment.machineId ? ` · ${latestDeployment.machineId}` : ""}
                </p>
              ) : null}
              {latestDeployment.blockers?.length ? (
                <p className="mt-2 text-xs leading-relaxed text-amber-100">
                  Blocked: {latestDeployment.blockers.join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-paper-faint">
              Maya is preparing the OpenClaw workspace now.
            </p>
          )}
        </div>
      </SetupPanel>
    );
  }

  return (
    <main className="min-h-screen bg-ink px-5 py-6 text-paper sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-lg flex-col">
        <div className="flex items-center justify-between">
          {previousStep && signedIn ? (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-paper-dim transition hover:text-paper"
              aria-label="Go back to the previous onboarding step"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            <Link href="/" className="font-display text-xl text-paper">
              HeyMaya
            </Link>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            Step {activeStepIndex + 1} of {SETUP_STEPS.length}
          </p>
        </div>

        <div className="mt-6 h-1 rounded-full bg-ink-3">
          <div
            className="h-full rounded-full bg-lime transition-all"
            style={{
              width: `${Math.max(
                8,
                ((activeStepIndex + 1) / SETUP_STEPS.length) * 100
              )}%`,
            }}
          />
        </div>

        <div className="grid flex-1 place-items-center py-10">
          <div className="w-full">
            {renderCurrentStep()}

            {(notice || error) && (
              <div
                className={`mt-4 rounded-md border p-3 text-sm ${
                  error
                    ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                    : "border-lime/25 bg-lime/10 text-lime-soft"
                }`}
              >
                {error ?? notice}
              </div>
            )}
          </div>
        </div>

        {signedIn ? (
          <div className="pb-2">
            <Link
              href="/account/delete"
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-paper-faint transition hover:text-rose"
            >
              <Trash2 className="h-4 w-4" />
              Delete account and restart
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function CreatorMayaV0DebugConsole() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useQuery(api.creatorMayaV0.backend.state);
  const getOrCreate = useMutation(api.creatorMayaV0.backend.getOrCreateAccount);
  const connectTikTokMock = useMutation(api.creatorMayaV0.backend.connectTikTokMock);
  const connectCalendar = useMutation(api.creatorMayaV0.backend.connectCalendarProvider);
  const submitIntake = useMutation(api.creatorMayaV0.backend.submitIntake);
  const confirmReadback = useMutation(api.creatorMayaV0.backend.confirmReadback);
  const collectPhone = useMutation(api.creatorMayaV0.backend.collectPhoneForNativePairing);
  const pairImessageMock = useMutation(api.creatorMayaV0.backend.pairImessage);
  const deployOpenClaw = useMutation(api.creatorMayaV0.backend.deployOpenClaw);
  const runBrief = useMutation(api.creatorMayaV0.backend.runMorningBrief);
  const scheduleHold = useMutation(api.creatorMayaV0.backend.scheduleLatestBriefHold);
  const queueBrand = useMutation(api.creatorMayaV0.backend.queueBrandTarget);
  const connectTikTokLive = useAction(
    api.creatorMayaV0.backend.connectTikTokWithScrapeCreators
  );
  const requestPairing = useAction(api.integrations.openclaw.channels.requestPairing);
  const confirmPairing = useAction(api.integrations.openclaw.channels.confirmPairing);
  const markNativePairing = useMutation(
    api.creatorMayaV0.backend.markImessagePairedFromNativeChannel
  );

  const [busy, setBusy] = useState<BusyKey>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("founder_maya");
  const [phone, setPhone] = useState("+15555550123");
  const [pairingId, setPairingId] = useState("");
  const [goal, setGoal] = useState("grow authority and become sponsor-ready");
  const [blocker, setBlocker] = useState("inconsistent posting");
  const [nicheCorrection, setNicheCorrection] = useState(
    "solo founder TikTok education"
  );
  const [weeklyHours, setWeeklyHours] = useState(4);

  const email = user?.primaryEmailAddress?.emailAddress ?? "creator@example.com";
  const signedIn = Boolean(user);
  const now = useMemo(() => Date.UTC(2026, 4, 4, 11, 0, 0), []);
  const slot = useMemo(() => Date.UTC(2026, 4, 4, 19, 0, 0), []);
  const sanitizedHandle = handle.replace(/^@/, "").trim();
  const hasLiveFlyApp = Boolean(state?.creator?.mayaFlyAppId);

  useEffect(() => {
    const googleCalendar = searchParams.get("googleCalendar");
    if (!googleCalendar) return;
    const timeout = window.setTimeout(() => {
      if (googleCalendar === "connected") {
        const imported = searchParams.get("imported") ?? "0";
        setLog((current) => [
          ...current,
          `Google Calendar connected with ${imported} lookahead events`,
        ]);
      } else if (googleCalendar === "error") {
        setError(stripStack(searchParams.get("error") ?? "Google Calendar failed"));
      }
      router.replace("/creator-maya-v0");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams, router]);

  async function ensureAccount() {
    await getOrCreate({ email, timezone: TZ, tier: "starter" });
  }

  async function runStep(key: Exclude<BusyKey, null>, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(stripStack((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function connectLiveTikTok() {
    await runStep("tiktok", async () => {
      await ensureAccount();
      await connectTikTokLive({ handle: sanitizedHandle });
      setLog((current) => [...current, `Connected @${sanitizedHandle} through ScrapeCreators`]);
    });
  }

  async function useDemoTikTok() {
    await runStep("tiktok", async () => {
      await ensureAccount();
      await connectTikTokMock({
        handle: sanitizedHandle || "founder_maya",
        displayName: "Founder Maya",
        followerCount: 42000,
        bio: "Founder building in public with result-first demos",
      });
      setLog((current) => [...current, "Loaded demo TikTok profile and selected video samples"]);
    });
  }

  async function connectApplePhoneCalendar() {
    await runStep("calendar", async () => {
      await ensureAccount();
      await connectCalendar({
        provider: "apple",
        providerMode: "apple_phone_api",
        timezone: TZ,
        lookaheadDays: 14,
        canCreateHolds: true,
      });
      setLog((current) => [
        ...current,
        "Apple Calendar bridge selected; iPhone permission happens after iMessage pairing",
      ]);
    });
  }

  async function connectGoogleCalendar() {
    await runStep("calendar", async () => {
      await ensureAccount();
      window.location.assign("/api/google-calendar/start");
    });
  }

  async function submitCreatorIntake() {
    await runStep("intake", async () => {
      await ensureAccount();
      await submitIntake({
        ninetyDayGoal: goal,
        creatorStage: "growing_consistently",
        biggestBlocker: blocker,
        weeklyHoursAvailable: weeklyHours,
        tone: "strategic",
        doNotSuggest: ["daily vlogs"],
      });
      await confirmReadback({
        corrections: { niche: nicheCorrection },
      });
      setLog((current) => [...current, "Creator picture generated and confirmed"]);
    });
  }

  async function preparePhoneHandoff() {
    await runStep("phone", async () => {
      await ensureAccount();
      await collectPhone({ phoneNumber: phone.trim() });
      setLog((current) => [...current, "Phone number saved for native iMessage pairing"]);
    });
  }

  async function deployMaya() {
    await runStep("deploy", async () => {
      const result = await deployOpenClaw({ mode: "mock" });
      if (result.ok !== true) {
        const blockers =
          "blockers" in result && Array.isArray(result.blockers)
            ? result.blockers.join(", ")
            : "unknown blocker";
        setLog((current) => [...current, `OpenClaw deploy blocked: ${blockers}`]);
        return;
      }
      setLog((current) => [...current, `OpenClaw workspace manifest ready: ${result.deployLabel}`]);
    });
  }

  async function requestNativePairing() {
    await runStep("pair", async () => {
      const res = await requestPairing({
        channel: "imessage",
        phoneNumber: phone.trim(),
      });
      setPairingId(res.pairingId);
      setLog((current) => [...current, "OpenClaw iMessage pairing requested"]);
    });
  }

  async function confirmNativePairing() {
    if (!pairingId.trim()) return;
    await runStep("pair", async () => {
      await confirmPairing({ pairingId: pairingId.trim() });
      await markNativePairing({});
      setLog((current) => [...current, "OpenClaw iMessage pairing confirmed"]);
    });
  }

  async function runMockMvp() {
    setRunState("running");
    await runStep("demo", async () => {
      setLog([]);
      await ensureAccount();
      await connectTikTokMock({
        handle: "founder_maya",
        displayName: "Founder Maya",
        followerCount: 42000,
        bio: "Founder building in public with result-first demos",
      });
      await connectCalendar({
        provider: "google",
        providerMode: "google_api",
        timezone: "America/New_York",
        externalAccountId: "mock_google_calendar_account",
        lookaheadDays: 14,
        availabilityWindows: [{ startMs: slot, endMs: slot + 2 * 60 * 60 * 1000 }],
        lookaheadEvents: [
          {
            providerEventId: "launch-demo-day",
            title: "Product launch demo day",
            description: "Creator Maya launch moment worth filming",
            startMs: slot + 24 * 60 * 60 * 1000,
            endMs: slot + 26 * 60 * 60 * 1000,
            location: "studio",
          },
        ],
        canCreateHolds: true,
      });
      await submitIntake({
        ninetyDayGoal: "grow authority and become sponsor-ready",
        creatorStage: "growing_consistently",
        biggestBlocker: "inconsistent posting",
        weeklyHoursAvailable: 4,
        tone: "strategic",
        doNotSuggest: ["daily vlogs"],
      });
      await confirmReadback({
        corrections: { niche: "solo founder TikTok education" },
      });
      await pairImessageMock({ phoneNumber: "+15555550123" });
      await deployOpenClaw({ mode: "mock" });
      await runBrief({ nowMs: now });
      await scheduleHold({});
      setLog([
        "Created account",
        "Connected TikTok metadata and selected video samples",
        "Imported calendar lookahead",
        "Built creator picture",
        "Mock-paired iMessage",
        "Generated first phone-ready morning brief",
        "Scheduled the approved content hold",
      ]);
      setRunState("ready");
    });
  }

  async function testStudioBrandGate() {
    await runStep("brand", async () => {
      await getOrCreate({ email, timezone: TZ, tier: "studio" });
      await queueBrand({
        brandName: "DeskKit",
        category: "workspace gear",
        contactProvenance: "brand website",
        audienceFit: 0.9,
        contentFit: 0.9,
        timingFit: 0.8,
        valuesFit: 0.8,
        requestedAutonomyLevel: 2,
        creatorApproved: true,
        suppressed: false,
      });
      setLog((current) => [...current, "Studio brand target queued behind approval"]);
    });
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-[var(--hairline)] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              Creator Maya v0 · Powered by OpenClaw
            </p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight text-paper sm:text-5xl">
              Onboard once. Maya manages TikTok from iMessage.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-paper-dim sm:text-base">
              The web app creates the account, captures creator context,
              connects TikTok and calendar, and collects a phone number. After
              native OpenClaw iMessage pairing, daily planning, replies, and
              scheduling move to the creator&apos;s phone.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {signedIn ? (
              <>
                <button
                  type="button"
                  onClick={runMockMvp}
                  disabled={busy !== null}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-lime px-4 text-sm font-medium text-black transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === "demo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Preview Beta Handoff
                </button>
                <button
                  type="button"
                  onClick={testStudioBrandGate}
                  disabled={busy !== null}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--hairline-strong)] px-4 text-sm text-paper-dim transition hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Test Studio Brand Gate
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/sign-up?redirect_url=/creator-maya-v0"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-lime px-4 text-sm font-medium text-black transition hover:brightness-95"
                >
                  <UserRound className="h-4 w-4" />
                  Create account
                </Link>
                <Link
                  href="/sign-in?redirect_url=/creator-maya-v0"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--hairline-strong)] px-4 text-sm text-paper-dim transition hover:text-paper"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <FlowStep
            icon={<UserRound className="h-4 w-4" />}
            title="Create account"
            text="Clerk identity and Convex creator record."
          />
          <FlowStep
            icon={<Link2 className="h-4 w-4" />}
            title="Connect context"
            text="TikTok, calendar, goals, constraints, and Maya readback."
          />
          <FlowStep
            icon={<Smartphone className="h-4 w-4" />}
            title="Pair iMessage"
            text="Phone number starts native OpenClaw iMessage pairing."
          />
          <FlowStep
            icon={<MessageSquareText className="h-4 w-4" />}
            title="Live on phone"
            text="Daily plans, replies, and scheduling happen in iMessage."
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatusTile
            icon={<Radar className="h-4 w-4" />}
            label="Onboarding"
            value={state?.onboarding?.currentStep ?? "not started"}
            active={state?.onboarding?.currentStep === "active"}
          />
          <StatusTile
            icon={<CalendarClock className="h-4 w-4" />}
            label="Calendar"
            value={state?.calendar?.providerMode ?? state?.calendar?.status ?? "not connected"}
            active={state?.calendar?.status === "active"}
          />
          <StatusTile
            icon={<MessageSquareText className="h-4 w-4" />}
            label="Phone"
            value={state?.onboarding?.imessagePaired ? "iMessage paired" : state?.creator?.phoneNumber ? "phone collected" : "iMessage required"}
            active={state?.onboarding?.imessagePaired === true}
          />
          <StatusTile
            icon={<Send className="h-4 w-4" />}
            label="OpenClaw"
            value={state?.creator?.mayaFlyAppId ?? state?.latestDeployment?.status ?? "not deployed"}
            active={state?.latestDeployment?.status === "deployed"}
          />
        </section>

        {signedIn ? (
          <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-5">
              <SetupPanel
                number="1"
                title="Account"
                action={
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => runStep("account", ensureAccount)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
                  >
                    {busy === "account" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Start beta setup
                  </button>
                }
              >
                <Fact label="Email" value={email} />
                <Fact label="Timezone" value={TZ} />
              </SetupPanel>

              <SetupPanel
                number="2"
                title="TikTok context"
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null || !sanitizedHandle}
                      onClick={connectLiveTikTok}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lime px-3 text-sm font-medium text-black disabled:opacity-60"
                    >
                      {busy === "tiktok" && <Loader2 className="h-4 w-4 animate-spin" />}
                      Connect TikTok
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={useDemoTikTok}
                      className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim disabled:opacity-60"
                    >
                      Use demo profile
                    </button>
                  </div>
                }
              >
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                    TikTok handle
                  </span>
                  <input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-paper-dim"
                    placeholder="founder_maya"
                  />
                </label>
                <p className="mt-3 text-xs leading-relaxed text-paper-faint">
                  Maya pulls metadata broadly, then samples only the most useful
                  video subset for analysis. She does not need Gemini to watch
                  30 full posts during onboarding.
                </p>
              </SetupPanel>

              <SetupPanel
                number="3"
                title="Calendar for planning"
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={connectGoogleCalendar}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Google Calendar
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={connectApplePhoneCalendar}
                      className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim disabled:opacity-60"
                    >
                      Apple on iPhone
                    </button>
                  </div>
                }
              >
                <p className="text-sm leading-relaxed text-paper-dim">
                  Google connects by OAuth during onboarding. Apple Calendar is
                  phone-native: after iMessage pairing, OpenClaw asks for local
                  calendar permission and sends Maya a privacy-filtered
                  lookahead for content planning and holds.
                </p>
              </SetupPanel>

              <SetupPanel
                number="4"
                title="Creator picture"
                action={
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={submitCreatorIntake}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
                  >
                    {busy === "intake" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save readback
                  </button>
                }
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="90-day goal" value={goal} onChange={setGoal} />
                  <TextInput label="Biggest blocker" value={blocker} onChange={setBlocker} />
                  <TextInput label="Niche correction" value={nicheCorrection} onChange={setNicheCorrection} />
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                      Weekly hours
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={weeklyHours}
                      onChange={(event) => setWeeklyHours(Number(event.target.value))}
                      className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-paper-dim"
                    />
                  </label>
                </div>
              </SetupPanel>

              <SetupPanel
                number="5"
                title="Phone handoff"
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={preparePhoneHandoff}
                      className="inline-flex min-h-10 items-center rounded-md bg-paper px-3 text-sm font-medium text-ink disabled:opacity-60"
                    >
                      Save phone
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={deployMaya}
                      className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim disabled:opacity-60"
                    >
                      Prepare OpenClaw
                    </button>
                  </div>
                }
              >
                <TextInput label="Phone in E.164" value={phone} onChange={setPhone} />
                <p className="mt-3 text-xs leading-relaxed text-paper-faint">
                  Live iMessage pairing requires a real OpenClaw/Fly app id on
                  the creator row. Mock deploy validates the workspace manifest;
                  live deploy unlocks the native pairing request.
                </p>
              </SetupPanel>

              <SetupPanel
                number="6"
                title="Native iMessage"
                action={
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null || !hasLiveFlyApp}
                      onClick={requestNativePairing}
                      className="inline-flex min-h-10 items-center rounded-md bg-lime px-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Request iMessage pairing
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || !pairingId.trim()}
                      onClick={confirmNativePairing}
                      className="inline-flex min-h-10 items-center rounded-md border border-[var(--hairline-strong)] px-3 text-sm text-paper-dim disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Confirm pairing
                    </button>
                  </div>
                }
              >
                <TextInput label="OpenClaw pairing id" value={pairingId} onChange={setPairingId} />
              </SetupPanel>
            </div>

            <aside className="space-y-5">
              <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-2xl text-paper">Beta Receipt</h2>
                  {runState === "ready" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-lime/30 px-3 py-1 text-xs text-lime">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      phone handoff ready
                    </span>
                  )}
                </div>
                <dl className="mt-5 grid gap-4">
                  <Fact label="Niche" value={state?.picture?.niche} />
                  <Fact label="Goal" value={state?.picture?.goal} />
                  <Fact label="Stage" value={state?.picture?.stage} />
                  <Fact label="TikTok" value={state?.tiktok?.handle ? `@${state.tiktok.handle}` : undefined} />
                  <Fact label="Calendar Mode" value={state?.calendar?.providerMode} />
                  <Fact label="Lookahead Events" value={state?.calendarEvents ? String(state.calendarEvents.length) : undefined} />
                  <Fact label="Native iMessage Rows" value={state?.pairedChannels ? String(state.pairedChannels.length) : undefined} />
                  <Fact label="Fly App" value={state?.creator?.mayaFlyAppId} />
                </dl>
              </div>

              <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-5">
                <h2 className="font-display text-2xl text-paper">Handoff Log</h2>
                <div className="mt-4 space-y-2 font-mono text-xs text-paper-dim">
                  {log.length === 0 ? (
                    <p>No run yet.</p>
                  ) : (
                    log.map((line) => (
                      <p key={line} className="border-l border-[var(--hairline-strong)] pl-3">
                        {line}
                      </p>
                    ))
                  )}
                  {error && <p className="text-amber-300">{error}</p>}
                </div>
              </div>
            </aside>
          </section>
        ) : (
          <section className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-5">
            <h2 className="font-display text-2xl text-paper">Create your account to start</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-paper-dim">
              Creator Maya starts here, but the operating product is your
              iMessage thread with Maya. Sign up, finish the short setup, and
              Maya will begin planning around your TikTok niche and calendar.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function SetupPanel({ title, action, children }: {
  number: string;
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="font-display text-3xl text-paper">{title}</h2>
        </div>
        <div>{children}</div>
        {action}
      </div>
    </section>
  );
}

function ConnectedProfile({
  avatarUrl,
  title,
  subtitle,
  body,
}: {
  avatarUrl?: string;
  title?: string;
  subtitle: string;
  body: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-lime/25 bg-lime/10 p-4">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-14 w-14 rounded-full border border-lime/30 object-cover"
        />
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-full bg-ink-3 text-lime">
          <UserRound className="h-6 w-6" />
        </span>
      )}
      <div>
        <p className="flex items-center gap-2 text-sm font-medium text-paper">
          <CheckCircle2 className="h-4 w-4 text-lime" />
          {title ?? "Connected account"}
        </p>
        <p className="mt-1 text-sm text-paper-dim">{subtitle}</p>
        <p className="mt-2 text-xs leading-relaxed text-paper-faint">{body}</p>
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-paper-dim"
      />
    </label>
  );
}

function FlowStep({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-3 text-lime">
        {icon}
      </div>
      <h2 className="mt-4 text-sm font-semibold text-paper">{title}</h2>
      <p className="mt-2 text-xs leading-relaxed text-paper-dim">{text}</p>
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  active,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={active ? "text-lime" : "text-paper-faint"}>{icon}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          {label}
        </span>
      </div>
      <p className="mt-4 truncate text-sm text-paper">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border-t border-[var(--hairline)] pt-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-paper">{value ?? "pending"}</dd>
    </div>
  );
}

function stripStack(message: string): string {
  return message.split("\n")[0] ?? message;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}
