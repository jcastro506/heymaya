/**
 * Google Calendar action wrappers (Composio v3) — READ-ONLY in v0.
 *
 * Sprint 5. Maya's calendar surface for the calendar-aware content planning
 * behavior (playbook § Calendar-aware content planning). Maya only READS the
 * calendar — she never creates events. (If a creator opts into "Maya schedules
 * my deal calls", that would be a separate, explicitly-named wrapper with a
 * higher tier gate.)
 */

import { z } from "zod";
import { runAction } from "../universalRunner";
import type { ComposioClient } from "../client";

export interface CalendarActionContext {
  connectedAccountId: string;
  client?: ComposioClient;
}

/* -------------------------------------------------------------------------- */
/* listEvents                                                                  */
/* -------------------------------------------------------------------------- */

export const ListEventsParamsSchema = z.object({
  /** RFC3339 timestamp (e.g. 2026-04-26T00:00:00Z). */
  timeMin: z.string().min(1),
  timeMax: z.string().min(1),
  calendarId: z.string().optional().default("primary"),
  maxResults: z.number().int().positive().max(2500).optional(),
  singleEvents: z.boolean().optional().default(true),
  orderBy: z.enum(["startTime", "updated"]).optional(),
});
export type ListEventsParams = z.infer<typeof ListEventsParamsSchema>;

const CalendarEventTimeSchema = z
  .object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  })
  .passthrough();

const CalendarEventSchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    description: z.string().optional(),
    start: CalendarEventTimeSchema.optional(),
    end: CalendarEventTimeSchema.optional(),
    status: z.string().optional(),
    location: z.string().optional(),
    htmlLink: z.string().optional(),
    attendees: z
      .array(
        z
          .object({
            email: z.string(),
            displayName: z.string().optional(),
            responseStatus: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const ListEventsResponseSchema = z
  .object({
    items: z.array(CalendarEventSchema).default([]),
    nextPageToken: z.string().optional(),
  })
  .passthrough();
export type ListEventsResponse = z.infer<typeof ListEventsResponseSchema>;

export async function listEvents(
  ctx: CalendarActionContext,
  params: ListEventsParams
): Promise<ListEventsResponse> {
  const validated = ListEventsParamsSchema.parse(params);
  const result = await runAction({
    provider: "calendar",
    action: "GOOGLECALENDAR_LIST_EVENTS",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: ListEventsResponseSchema,
    client: ctx.client,
  });
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* getEvent                                                                    */
/* -------------------------------------------------------------------------- */

export const GetEventParamsSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().optional().default("primary"),
});
export type GetEventParams = z.infer<typeof GetEventParamsSchema>;

export const GetEventResponseSchema = CalendarEventSchema;
export type GetEventResponse = z.infer<typeof GetEventResponseSchema>;

export async function getEvent(
  ctx: CalendarActionContext,
  params: GetEventParams
): Promise<GetEventResponse> {
  const validated = GetEventParamsSchema.parse(params);
  const result = await runAction({
    provider: "calendar",
    action: "GOOGLECALENDAR_GET_EVENT",
    params: validated,
    connectedAccountId: ctx.connectedAccountId,
    responseSchema: GetEventResponseSchema,
    client: ctx.client,
  });
  return result.data;
}
