import type { GtmStrategyPlan } from "./strategyJudge";

export interface GtmCalendarEvent {
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

export function buildSevenDayCalendarPlan(input: {
  plan: GtmStrategyPlan;
  startDateIso: string;
  timezone: string;
  productName: string;
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
