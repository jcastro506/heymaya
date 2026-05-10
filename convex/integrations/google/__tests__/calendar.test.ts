/**
 * Google Calendar API wrapper tests (Sprint 12 Phase 1C).
 *
 * Mocked-fetch coverage of the URL / header / body / response-parsing
 * shape for listCalendarEvents, createCalendarEvent, updateCalendarEvent,
 * deleteCalendarEvent. Mirrors the pattern in gmail.test.ts.
 *
 * Five mandatory categories:
 *   1. Cross-tenant isolation — N/A; wrappers are stateless on accessToken.
 *   2. Plan-tier — N/A; gating happens at the orchestrating-action layer.
 *   3. Adversarial — error responses (4xx/5xx) surface as
 *      GoogleCalendarApiError; eventId path-traversal is URL-encoded.
 *   4. Sibling-file scan — wrappers use raw fetch (matches gmail.ts +
 *      backend.ts pattern).
 *   5. TODO grep — covered repo-wide.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleCalendarApiError,
  _internal,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "../calendar";

const ACCESS_TOKEN = "test-access-token";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(
  status: number,
  body: unknown,
  capture?: { url?: string; init?: RequestInit }
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (capture) {
        capture.url = url;
        capture.init = init;
      }
      const isText = typeof body === "string";
      // 204 has no body; the wrappers handle that path explicitly.
      if (status === 204) {
        return new Response(null, { status });
      }
      return new Response(isText ? (body as string) : JSON.stringify(body), {
        status,
        headers: {
          "content-type": isText ? "text/plain" : "application/json",
        },
      });
    })
  );
}

/* -------------------------------------------------------------------------- */
/* listCalendarEvents                                                          */
/* -------------------------------------------------------------------------- */

describe("listCalendarEvents", () => {
  it("HAPPY: defaults to primary calendar, singleEvents=true, orderBy=startTime, maxResults=100", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(
      200,
      {
        items: [
          {
            id: "e1",
            summary: "Filming",
            start: { dateTime: "2026-05-12T15:00:00-04:00" },
            end: { dateTime: "2026-05-12T17:00:00-04:00" },
          },
        ],
      },
      cap
    );
    const out = await listCalendarEvents(ACCESS_TOKEN, {
      timeMin: "2026-05-10T00:00:00Z",
      timeMax: "2026-05-20T00:00:00Z",
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.id).toBe("e1");
    expect(cap.url).toContain("/calendars/primary/events");
    expect(cap.url).toContain("singleEvents=true");
    expect(cap.url).toContain("orderBy=startTime");
    expect(cap.url).toContain("maxResults=100");
    expect(cap.url).toContain("timeMin=2026-05-10T00%3A00%3A00Z");
    expect((cap.init?.headers as Record<string, string>)?.Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`
    );
  });

  it("ADVERSARIAL: caller-supplied calendarId is URL-encoded", async () => {
    const cap: { url?: string } = {};
    mockFetch(200, { items: [] }, cap);
    await listCalendarEvents(ACCESS_TOKEN, {
      timeMin: "2026-05-10T00:00:00Z",
      timeMax: "2026-05-20T00:00:00Z",
      calendarId: "user@example.com",
    });
    expect(cap.url).toContain("/calendars/user%40example.com/events");
  });

  it("HAPPY: empty items returns empty list, not undefined", async () => {
    mockFetch(200, {});
    const out = await listCalendarEvents(ACCESS_TOKEN, {
      timeMin: "2026-05-10T00:00:00Z",
      timeMax: "2026-05-20T00:00:00Z",
    });
    expect(out.items).toEqual([]);
  });

  it("ADVERSARIAL: 401 throws GoogleCalendarApiError with status", async () => {
    mockFetch(401, { error: { message: "Invalid Credentials" } });
    await expect(
      listCalendarEvents(ACCESS_TOKEN, {
        timeMin: "2026-05-10T00:00:00Z",
        timeMax: "2026-05-20T00:00:00Z",
      })
    ).rejects.toMatchObject({
      name: "GoogleCalendarApiError",
      status: 401,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* createCalendarEvent                                                         */
/* -------------------------------------------------------------------------- */

describe("createCalendarEvent", () => {
  it("HAPPY: POSTs to /events with the full payload and returns id+htmlLink", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(
      200,
      {
        id: "evt-1",
        htmlLink: "https://calendar.google.com/event?eid=xyz",
        summary: "Filming",
      },
      cap
    );
    const out = await createCalendarEvent(ACCESS_TOKEN, {
      payload: {
        summary: "Filming",
        description: "Batch shoot",
        location: "Brooklyn studio",
        start: { dateTime: "2026-05-12T15:00:00-04:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-05-12T17:00:00-04:00", timeZone: "America/New_York" },
      },
    });
    expect(out.id).toBe("evt-1");
    expect(out.htmlLink).toContain("calendar.google.com");
    expect(cap.url).toContain("/calendars/primary/events");
    expect(cap.init?.method).toBe("POST");
    const sentBody = JSON.parse((cap.init?.body as string) ?? "{}");
    expect(sentBody.summary).toBe("Filming");
    expect(sentBody.start.dateTime).toBe("2026-05-12T15:00:00-04:00");
    expect(sentBody.end.dateTime).toBe("2026-05-12T17:00:00-04:00");
  });

  it("HAPPY: targets the supplied calendarId when set", async () => {
    const cap: { url?: string } = {};
    mockFetch(
      200,
      { id: "evt-1", htmlLink: "https://calendar.google.com/x" },
      cap
    );
    await createCalendarEvent(ACCESS_TOKEN, {
      calendarId: "creator@workspace.com",
      payload: {
        summary: "x",
        start: { dateTime: "2026-05-12T15:00:00-04:00" },
        end: { dateTime: "2026-05-12T17:00:00-04:00" },
      },
    });
    expect(cap.url).toContain("/calendars/creator%40workspace.com/events");
  });

  it("ADVERSARIAL: response missing id throws (refuses partial result)", async () => {
    mockFetch(200, { htmlLink: "https://x" });
    await expect(
      createCalendarEvent(ACCESS_TOKEN, {
        payload: {
          summary: "x",
          start: { dateTime: "2026-05-12T15:00:00-04:00" },
          end: { dateTime: "2026-05-12T17:00:00-04:00" },
        },
      })
    ).rejects.toBeInstanceOf(GoogleCalendarApiError);
  });

  it("ADVERSARIAL: 403 (calendar.events scope missing) surfaces as GoogleCalendarApiError 403", async () => {
    mockFetch(403, { error: { message: "Insufficient Permission" } });
    await expect(
      createCalendarEvent(ACCESS_TOKEN, {
        payload: {
          summary: "x",
          start: { dateTime: "2026-05-12T15:00:00-04:00" },
          end: { dateTime: "2026-05-12T17:00:00-04:00" },
        },
      })
    ).rejects.toMatchObject({ name: "GoogleCalendarApiError", status: 403 });
  });
});

/* -------------------------------------------------------------------------- */
/* updateCalendarEvent                                                         */
/* -------------------------------------------------------------------------- */

describe("updateCalendarEvent", () => {
  it("HAPPY: PATCHes /events/<id> with partial payload (summary only)", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(
      200,
      {
        id: "evt-1",
        htmlLink: "https://calendar.google.com/x",
        summary: "Filming v2",
      },
      cap
    );
    const out = await updateCalendarEvent(ACCESS_TOKEN, {
      eventId: "evt-1",
      payload: { summary: "Filming v2" },
    });
    expect(out.id).toBe("evt-1");
    expect(cap.url).toContain("/calendars/primary/events/evt-1");
    expect(cap.init?.method).toBe("PATCH");
    const sentBody = JSON.parse((cap.init?.body as string) ?? "{}");
    expect(sentBody.summary).toBe("Filming v2");
    // Did NOT pad with start/end — partial PATCH semantic.
    expect(sentBody.start).toBeUndefined();
    expect(sentBody.end).toBeUndefined();
  });

  it("HAPPY: rescheduling sends full start+end blocks (Google PATCH limitation)", async () => {
    const cap: { init?: RequestInit } = {};
    mockFetch(
      200,
      { id: "evt-1", htmlLink: "https://calendar.google.com/x" },
      cap
    );
    await updateCalendarEvent(ACCESS_TOKEN, {
      eventId: "evt-1",
      payload: {
        start: { dateTime: "2026-05-13T10:00:00-04:00" },
        end: { dateTime: "2026-05-13T12:00:00-04:00" },
      },
    });
    const sentBody = JSON.parse((cap.init?.body as string) ?? "{}");
    expect(sentBody.start.dateTime).toBe("2026-05-13T10:00:00-04:00");
    expect(sentBody.end.dateTime).toBe("2026-05-13T12:00:00-04:00");
  });

  it("ADVERSARIAL: empty eventId throws BEFORE issuing the request", async () => {
    let called = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        called++;
        return new Response("{}", { status: 200 });
      })
    );
    await expect(
      updateCalendarEvent(ACCESS_TOKEN, {
        eventId: "",
        payload: { summary: "x" },
      })
    ).rejects.toBeInstanceOf(GoogleCalendarApiError);
    expect(called).toBe(0);
  });

  it("ADVERSARIAL: eventId is URL-encoded so a malformed id can't path-traverse", async () => {
    const cap: { url?: string } = {};
    mockFetch(
      200,
      { id: "evt-1", htmlLink: "https://calendar.google.com/x" },
      cap
    );
    await updateCalendarEvent(ACCESS_TOKEN, {
      eventId: "abc/../admin",
      payload: { summary: "x" },
    });
    expect(cap.url).toContain("/events/abc%2F..%2Fadmin");
    expect(cap.url).not.toContain("/events/abc/..");
  });

  it("ADVERSARIAL: 404 (event missing) surfaces as GoogleCalendarApiError 404", async () => {
    mockFetch(404, { error: { message: "Not Found" } });
    await expect(
      updateCalendarEvent(ACCESS_TOKEN, {
        eventId: "ghost",
        payload: { summary: "x" },
      })
    ).rejects.toMatchObject({ name: "GoogleCalendarApiError", status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* deleteCalendarEvent                                                         */
/* -------------------------------------------------------------------------- */

describe("deleteCalendarEvent", () => {
  it("HAPPY: DELETEs /events/<id> and returns { ok, eventId } on 204", async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(204, null, cap);
    const out = await deleteCalendarEvent(ACCESS_TOKEN, { eventId: "evt-1" });
    expect(out).toEqual({ ok: true, eventId: "evt-1" });
    expect(cap.url).toContain("/calendars/primary/events/evt-1");
    expect(cap.init?.method).toBe("DELETE");
  });

  it("ADVERSARIAL: empty eventId throws BEFORE issuing the request", async () => {
    let called = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        called++;
        return new Response(null, { status: 204 });
      })
    );
    await expect(
      deleteCalendarEvent(ACCESS_TOKEN, { eventId: "" })
    ).rejects.toBeInstanceOf(GoogleCalendarApiError);
    expect(called).toBe(0);
  });

  it("ADVERSARIAL: eventId is URL-encoded", async () => {
    const cap: { url?: string } = {};
    mockFetch(204, null, cap);
    await deleteCalendarEvent(ACCESS_TOKEN, {
      eventId: "abc/../admin",
    });
    expect(cap.url).toContain("/events/abc%2F..%2Fadmin");
    expect(cap.url).not.toContain("/events/abc/..");
  });

  it("ADVERSARIAL: 410 Gone (already deleted) surfaces as GoogleCalendarApiError 410", async () => {
    mockFetch(410, { error: { message: "Resource has been deleted" } });
    await expect(
      deleteCalendarEvent(ACCESS_TOKEN, { eventId: "ghost" })
    ).rejects.toMatchObject({ name: "GoogleCalendarApiError", status: 410 });
  });

  it("ADVERSARIAL: 404 surfaces as GoogleCalendarApiError 404", async () => {
    mockFetch(404, { error: { message: "Not Found" } });
    await expect(
      deleteCalendarEvent(ACCESS_TOKEN, { eventId: "ghost" })
    ).rejects.toMatchObject({ name: "GoogleCalendarApiError", status: 404 });
  });
});

/* -------------------------------------------------------------------------- */
/* GoogleCalendarApiError shape                                                */
/* -------------------------------------------------------------------------- */

describe("GoogleCalendarApiError", () => {
  it("preserves status + truncates body to 400 chars", async () => {
    mockFetch(503, "x".repeat(1000));
    try {
      await listCalendarEvents(ACCESS_TOKEN, {
        timeMin: "2026-05-10T00:00:00Z",
        timeMax: "2026-05-20T00:00:00Z",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GoogleCalendarApiError);
      expect((err as GoogleCalendarApiError).status).toBe(503);
      expect(((err as GoogleCalendarApiError).body ?? "").length).toBeLessThanOrEqual(400);
    }
  });
});

describe("constants", () => {
  it("targets the v3 calendar API base", () => {
    expect(_internal.CALENDAR_BASE).toBe(
      "https://www.googleapis.com/calendar/v3"
    );
  });
});
