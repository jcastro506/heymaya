import type { GtmStrategyPlan } from "./strategyJudge";
import { planTikTokWarmup, type TikTokWarmupInput } from "./tiktokWarmup";

export interface GtmCalendarEvent {
  externalEventId?: string;
  owner: "maya";
  platform: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  description: string;
  evidenceCardIds: string[];
  successMetric: string;
  status: "draft" | "ready";
}

export interface BusyCalendarEvent {
  title: string;
  startsAt: string;
  durationMinutes: number;
  owner?: "maya" | "user" | "external";
}

export function buildSevenDayCalendarPlan(input: {
  plan: GtmStrategyPlan;
  startDateIso: string;
  timezone: string;
  productName: string;
  tiktokWarmup?: TikTokWarmupInput;
}): GtmCalendarEvent[] {
  const start = new Date(`${input.startDateIso}T09:00:00`);
  const events: GtmCalendarEvent[] = [];
  input.plan.firstWeekTests.forEach((test, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    events.push({
      owner: "maya",
      platform: test.channel,
      title: `${input.productName}: ${labelFor(test.channel)} test`,
      startsAt: toLocalIso(day),
      durationMinutes: test.channel === "tiktok" ? 45 : 30,
      description: eventDescription({
        channel: test.channel,
        test: test.test,
        thesis: input.plan.thesis,
        successMetric: test.successMetric,
        evidenceCardIds: test.evidenceCardIds,
        timezone: input.timezone,
      }),
      evidenceCardIds: test.evidenceCardIds,
      successMetric: test.successMetric,
      status: "draft",
    });
  });

  const warmup = input.tiktokWarmup
    ? planTikTokWarmup(input.tiktokWarmup)
    : null;
  if (
    warmup &&
    warmup.status === "warmup_required" &&
    input.plan.firstWeekTests.some((test) => test.channel === "tiktok")
  ) {
    const day = new Date(start);
    day.setHours(11, 0, 0, 0);
    events.push({
      owner: "maya",
      platform: "tiktok",
      title: `${input.productName}: TikTok account warm-up`,
      startsAt: toLocalIso(day),
      durationMinutes: 30,
      description: [
        "Strategy: TikTok is promising, but the account needs normal-use warm-up before launch cadence.",
        `Task: ${warmup.firstWeekCalendarTasks.join(" ")}`,
        "User action: use TikTok normally, collect reference posts, check TikTok Studio Account Check, then record and manually post only if clear.",
        `Timezone: ${input.timezone}`,
        "Evidence: TikTok recommendation and account-integrity readiness gate",
        `Success metric: Account Check clear and ${warmup.postingCapPerWeek} or fewer low-pressure posts this week`,
      ].join("\n"),
      evidenceCardIds: [],
      successMetric: "Account Check clear before TikTok launch cadence",
      status: "draft",
    });
  }

  const review = new Date(start);
  review.setDate(start.getDate() + 6);
  review.setHours(16, 0, 0, 0);
  events.push({
    owner: "maya",
    platform: "review",
    title: `${input.productName}: weekly GTM review`,
    startsAt: toLocalIso(review),
    durationMinutes: 30,
    description: [
      `Review the first-week GTM tests for ${input.productName}.`,
      `Timezone: ${input.timezone}`,
      `Primary: ${input.plan.primaryChannel}`,
      input.plan.secondaryChannel ? `Secondary: ${input.plan.secondaryChannel}` : null,
      `Parked: ${input.plan.parkedChannels.join(", ") || "none"}`,
      "Evidence: first-week event results, replies, signups, demo requests, and user feedback",
      "Success metric: clear keep/kill/double-down decision for next week",
      "Measure replies, signups, demo requests, and useful feedback before deciding next week.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    evidenceCardIds: [],
    successMetric: "clear keep/kill/double-down decision for next week",
    status: "draft",
  });

  return events;
}

export function validateCalendarEvents(
  events: ReadonlyArray<GtmCalendarEvent>
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const event of events) {
    if (event.owner !== "maya") failures.push(`${event.title} is not Maya-owned`);
    if (!event.description.includes("Evidence:")) {
      failures.push(`${event.title} is missing evidence section`);
    }
    if (!event.description.includes("Success metric:")) {
      failures.push(`${event.title} is missing success metric`);
    }
    if (
      event.platform === "tiktok" &&
      !event.description.toLowerCase().includes("record")
    ) {
      failures.push("TikTok event must be a recording handoff");
    }
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

export function placeEventsAroundBusyCalendar(input: {
  events: ReadonlyArray<GtmCalendarEvent>;
  busyEvents: ReadonlyArray<BusyCalendarEvent>;
  stepMinutes?: number;
  maxShifts?: number;
}): GtmCalendarEvent[] {
  const stepMinutes = input.stepMinutes ?? 30;
  const maxShifts = input.maxShifts ?? 10;
  const placed: GtmCalendarEvent[] = [];
  for (const event of input.events) {
    let candidate = event;
    let shifts = 0;
    while (
      shifts < maxShifts &&
      [...input.busyEvents, ...placed].some((busy) =>
        eventsOverlap(candidate, busy)
      )
    ) {
      candidate = shiftEvent(candidate, stepMinutes);
      shifts += 1;
    }
    placed.push(candidate);
  }
  return placed;
}

export function validateMayaCalendarMutation(input: {
  existing?: BusyCalendarEvent;
  next?: GtmCalendarEvent;
  operation: "create" | "update" | "delete";
}): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (
    (input.operation === "update" || input.operation === "delete") &&
    input.existing?.owner !== "maya"
  ) {
    failures.push("Maya may only update or delete Maya-owned events");
  }
  if (input.operation !== "delete" && !input.next) {
    failures.push("calendar mutation needs a next Maya event");
  }
  if (input.next && input.next.owner !== "maya") {
    failures.push("new calendar event must be Maya-owned");
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function eventDescription(input: {
  channel: string;
  test: string;
  thesis: string;
  successMetric: string;
  evidenceCardIds: string[];
  timezone: string;
}): string {
  const channelSpecific =
    input.channel === "tiktok"
      ? "User action: record and manually post. Maya does not auto-post TikTok in V1."
      : "User action: approve the draft before publishing or replying.";
  return [
    `Strategy: ${input.thesis}`,
    `Task: ${input.test}`,
    channelSpecific,
    `Timezone: ${input.timezone}`,
    `Evidence: ${input.evidenceCardIds.join(", ")}`,
    `Success metric: ${input.successMetric}`,
  ].join("\n");
}

function labelFor(channel: string): string {
  switch (channel) {
    case "reddit":
      return "reply-first Reddit";
    case "x":
      return "founder-led X";
    case "linkedin":
      return "LinkedIn buyer-context";
    case "tiktok":
      return "TikTok recording";
    default:
      return channel;
  }
}

function toLocalIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function eventsOverlap(
  a: Pick<BusyCalendarEvent, "startsAt" | "durationMinutes">,
  b: Pick<BusyCalendarEvent, "startsAt" | "durationMinutes">
): boolean {
  const aStart = new Date(a.startsAt).getTime();
  const bStart = new Date(b.startsAt).getTime();
  const aEnd = aStart + a.durationMinutes * 60_000;
  const bEnd = bStart + b.durationMinutes * 60_000;
  return aStart < bEnd && bStart < aEnd;
}

function shiftEvent(event: GtmCalendarEvent, minutes: number): GtmCalendarEvent {
  const next = new Date(event.startsAt);
  next.setMinutes(next.getMinutes() + minutes);
  return { ...event, startsAt: toLocalIso(next) };
}
