export type CalendarProviderMode = "google_api" | "apple_phone_api" | "mock";

export type CalendarEventClassification =
  | "creator_relevant"
  | "creator_shoot"
  | "work_meeting"
  | "recurring_noise"
  | "personal_private";

export interface CalendarLookaheadEventInput {
  providerEventId: string;
  title: string;
  description?: string;
  startMs: number;
  endMs: number;
  location?: string;
  recurring?: boolean;
}

export interface CalendarContentArc {
  offsetDays: number;
  title: string;
  prompt: string;
}

export interface CalendarLookaheadEvent {
  providerEventId: string;
  title: string;
  description?: string;
  startMs: number;
  endMs: number;
  classification: CalendarEventClassification;
  privacyRedacted: boolean;
  contentArc: CalendarContentArc[];
}

const SHOOT_TERMS = [
  "film",
  "shoot",
  "record",
  "podcast",
  "photoshoot",
  "content",
  "studio",
];

const CREATOR_RELEVANT_TERMS = [
  "launch",
  "drop",
  "release",
  "trip",
  "travel",
  "conference",
  "event",
  "wedding",
  "anniversary",
  "birthday",
  "graduation",
  "brand",
  "sponsor",
  "collab",
  "panel",
  "talk",
  "workshop",
];

const WORK_TERMS = [
  "standup",
  "sync",
  "1:1",
  "one-on-one",
  "retro",
  "planning meeting",
  "team meeting",
];

const PRIVATE_TERMS = [
  "doctor",
  "dentist",
  "therapy",
  "medical",
  "tax",
  "bank",
  "school pickup",
];

export function classifyCalendarEvent(
  event: CalendarLookaheadEventInput
): CalendarEventClassification {
  const haystack = `${event.title} ${event.description ?? ""}`.toLowerCase();
  if (PRIVATE_TERMS.some((term) => haystack.includes(term))) {
    return "personal_private";
  }
  if (event.recurring || WORK_TERMS.some((term) => haystack.includes(term))) {
    return "recurring_noise";
  }
  if (SHOOT_TERMS.some((term) => haystack.includes(term))) {
    return "creator_shoot";
  }
  if (CREATOR_RELEVANT_TERMS.some((term) => haystack.includes(term))) {
    return "creator_relevant";
  }
  return "work_meeting";
}

export function buildCalendarContentArc(
  event: CalendarLookaheadEventInput,
  classification: CalendarEventClassification
): CalendarContentArc[] {
  if (
    classification !== "creator_relevant" &&
    classification !== "creator_shoot"
  ) {
    return [];
  }

  const eventLabel = sanitizeEventTitle(event.title);
  return [
    {
      offsetDays: -3,
      title: `Build-up: ${eventLabel}`,
      prompt: `Create a short setup post explaining why ${eventLabel} matters and what the audience should watch for.`,
    },
    {
      offsetDays: 0,
      title: `Day-of capture: ${eventLabel}`,
      prompt: `Capture three specific moments during ${eventLabel}: context, tension, and payoff.`,
    },
    {
      offsetDays: 1,
      title: `Recap: ${eventLabel}`,
      prompt: `Turn the strongest moment from ${eventLabel} into a result-first recap post.`,
    },
  ];
}

export function normalizeCalendarLookaheadEvents(
  events: ReadonlyArray<CalendarLookaheadEventInput>
): CalendarLookaheadEvent[] {
  return events.map((event) => {
    const classification = classifyCalendarEvent(event);
    const privacyRedacted = classification === "personal_private";
    return {
      providerEventId: event.providerEventId,
      title: privacyRedacted ? "Private event" : event.title,
      description: privacyRedacted ? undefined : event.description,
      startMs: event.startMs,
      endMs: event.endMs,
      classification,
      privacyRedacted,
      contentArc: buildCalendarContentArc(event, classification),
    };
  });
}

function sanitizeEventTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").slice(0, 80);
}
