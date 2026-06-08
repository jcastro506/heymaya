/**
 * Sprint 7 (top-tier) — the real-time intent strike GATE. The gate is the whole
 * ballgame, so it's tested exhaustively as pure functions: dedup, off-channel,
 * keyword, freshness, author-quality, velocity ranking, and the hard daily
 * strike budget. Plus a convex-test of the compile → evaluate → record flow.
 */
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  compileIntentWatch,
  prefilterIntentCandidates,
  recordStrike,
  type IntentWatch,
  type IntentCandidate,
} from "../intentStrike";

const DAY = 86_400_000;
const MIN = 60_000;

function baseWatch(over: Partial<IntentWatch> = {}): IntentWatch {
  return {
    phrases: ["tool that does", "alternative to datadog"],
    channels: ["reddit", "x"],
    dailyStrikeBudget: 3,
    strikesToday: 0,
    strikeDayStamp: "1970-01-01",
    seenThreadIds: [],
    ...over,
  };
}

function candidate(over: Partial<IntentCandidate> = {}): IntentCandidate {
  return {
    threadId: "t1",
    channel: "reddit",
    text: "anyone know a tool that does flaky test detection?",
    authorKarma: 500,
    authorAgeDays: 400,
    postedAtMs: 10 * MIN, // 10 min old when now=20min
    velocity: 5,
    ...over,
  };
}

describe("compileIntentWatch", () => {
  it("dedups + lowercases phrases and preserves same-day strike count", () => {
    const prior = baseWatch({ strikesToday: 2, strikeDayStamp: "1970-01-02", seenThreadIds: ["old"] });
    const w = compileIntentWatch({
      intentPhrases: ["Tool That Does", "tool that does", "  Alternative To Datadog  "],
      betChannels: ["Reddit", "reddit", "X"],
      prior,
      nowMs: DAY + 5 * MIN, // still 1970-01-02
    });
    expect(w.phrases).toEqual(["tool that does", "alternative to datadog"]);
    expect(w.channels).toEqual(["reddit", "x"]);
    expect(w.strikesToday).toBe(2); // preserved same-day
    expect(w.seenThreadIds).toEqual(["old"]); // carried
  });

  it("resets the strike count on a new day", () => {
    const prior = baseWatch({ strikesToday: 3, strikeDayStamp: "1970-01-01" });
    const w = compileIntentWatch({
      intentPhrases: ["x phrase"],
      betChannels: ["reddit"],
      prior,
      nowMs: DAY * 5, // a later day
    });
    expect(w.strikesToday).toBe(0);
  });
});

describe("prefilterIntentCandidates — the gate", () => {
  const now = 20 * MIN;

  it("passes a fresh, on-channel, on-phrase, quality-author thread", () => {
    const out = prefilterIntentCandidates([candidate()], baseWatch(), now);
    expect(out.survivors.map((s) => s.threadId)).toEqual(["t1"]);
    expect(out.survivors[0].matchedPhrase).toBe("tool that does");
  });

  it("drops an already-seen thread (dedup)", () => {
    const out = prefilterIntentCandidates(
      [candidate({ threadId: "seen1" })],
      baseWatch({ seenThreadIds: ["seen1"] }),
      now
    );
    expect(out.survivors).toHaveLength(0);
    expect(out.dropped[0].reason).toBe("already_seen");
  });

  it("drops off-channel threads", () => {
    const out = prefilterIntentCandidates([candidate({ channel: "linkedin" })], baseWatch(), now);
    expect(out.dropped[0].reason).toBe("off_channel");
  });

  it("drops threads with no intent phrase", () => {
    const out = prefilterIntentCandidates(
      [candidate({ text: "just shipped a cool feature today" })],
      baseWatch(),
      now
    );
    expect(out.dropped[0].reason).toBe("no_intent_phrase");
  });

  it("drops stale threads (older than the freshness window)", () => {
    const out = prefilterIntentCandidates(
      [candidate({ postedAtMs: 0 })], // 200 min old at now=20min? no — make it clearly stale
      baseWatch(),
      4 * 60 * MIN // now = 240 min → candidate posted at 0 is 240 min old > 180
    );
    expect(out.dropped[0].reason).toBe("stale");
  });

  it("drops low-quality (throwaway/bot) authors", () => {
    const out = prefilterIntentCandidates(
      [candidate({ authorKarma: 1, authorAgeDays: 0 })],
      baseWatch(),
      now
    );
    expect(out.dropped[0].reason).toBe("low_author_quality");
  });

  it("ranks survivors by freshness + velocity and enforces the daily budget", () => {
    const cands = [
      candidate({ threadId: "old-slow", postedAtMs: 1 * MIN, velocity: 0 }), // older-ish, no velocity
      candidate({ threadId: "fresh-hot", postedAtMs: 19 * MIN, velocity: 10 }), // very fresh + hot
      candidate({ threadId: "mid", postedAtMs: 10 * MIN, velocity: 5 }),
    ];
    const out = prefilterIntentCandidates(cands, baseWatch({ dailyStrikeBudget: 2 }), now);
    // budget 2 → only top-2 by score survive; fresh-hot first.
    expect(out.survivors).toHaveLength(2);
    expect(out.survivors[0].threadId).toBe("fresh-hot");
    expect(out.dropped.some((d) => d.reason === "over_daily_budget")).toBe(true);
    expect(out.remainingBudget).toBe(0);
  });

  it("respects budget already partly spent today", () => {
    const out = prefilterIntentCandidates(
      [candidate({ threadId: "a" }), candidate({ threadId: "b" })],
      baseWatch({ dailyStrikeBudget: 3, strikesToday: 2, strikeDayStamp: "1970-01-01" }),
      now // 1970-01-01 → 1 strike left
    );
    expect(out.survivors).toHaveLength(1);
  });
});

describe("recordStrike", () => {
  it("increments strikes + marks struck/seen threads, dedup-safe", () => {
    const w = recordStrike(baseWatch(), ["t1"], ["t2", "t3"], 5 * MIN);
    expect(w.strikesToday).toBe(1);
    expect(new Set(w.seenThreadIds)).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("resets the day's count when crossing into a new day", () => {
    const w = recordStrike(
      baseWatch({ strikesToday: 3, strikeDayStamp: "1970-01-01" }),
      ["t9"],
      [],
      DAY * 4
    );
    expect(w.strikesToday).toBe(1); // new day → only this strike
  });
});

// ───────────────────────── convex-test (compile → evaluate → record) ─────────────────────────

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
  const hookToken = "fake-hook-" + subject;
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { hookToken };
}

function post(
  t: ReturnType<typeof convexTest>,
  path: string,
  hookToken: string,
  body: Record<string, unknown>
) {
  return t.fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${hookToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Sprint 7 — intent watch flow (server)", () => {
  it("builds a watch, gates candidates, and budget falls after a strike", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_intent_flow");

    const built = (await post(t, "/lc_gtm/build_intent_watch", hookToken, {
      phrases: ["tool that does", "alternative to datadog"],
      channels: ["reddit"],
      dailyStrikeBudget: 2,
      nowMs: 0,
    }).then((r) => r.json())) as { ok: boolean; dailyStrikeBudget: number };
    expect(built.ok).toBe(true);
    expect(built.dailyStrikeBudget).toBe(2);

    const evald = (await post(t, "/lc_gtm/evaluate_intent", hookToken, {
      nowMs: 10 * MIN,
      candidates: [
        {
          threadId: "hot1",
          channel: "reddit",
          text: "anyone got a tool that does X?",
          authorKarma: 300,
          authorAgeDays: 200,
          postedAtMs: 5 * MIN,
          velocity: 8,
        },
        {
          threadId: "off1",
          channel: "linkedin",
          text: "tool that does Y",
          postedAtMs: 5 * MIN,
        },
      ],
    }).then((r) => r.json())) as {
      ok: boolean;
      survivors: Array<{ threadId: string }>;
      dropped: Array<{ reason: string }>;
    };
    expect(evald.survivors.map((s) => s.threadId)).toEqual(["hot1"]);
    expect(evald.dropped.some((d) => d.reason === "off_channel")).toBe(true);

    const recorded = (await post(t, "/lc_gtm/record_strike", hookToken, {
      struckThreadIds: ["hot1"],
      nowMs: 11 * MIN,
    }).then((r) => r.json())) as { ok: boolean; strikesToday: number };
    expect(recorded.strikesToday).toBe(1);

    // hot1 is now seen → re-evaluating drops it as already_seen.
    const again = (await post(t, "/lc_gtm/evaluate_intent", hookToken, {
      nowMs: 12 * MIN,
      candidates: [
        { threadId: "hot1", channel: "reddit", text: "tool that does X", authorKarma: 300, authorAgeDays: 200, postedAtMs: 5 * MIN },
      ],
    }).then((r) => r.json())) as { dropped: Array<{ reason: string }> };
    expect(again.dropped[0].reason).toBe("already_seen");
  });

  it("evaluate_intent refuses when no watch is compiled", async () => {
    const t = convexTest(schema, modules);
    const { hookToken } = await setupAgent(t, "u_intent_nowatch");
    const res = (await post(t, "/lc_gtm/evaluate_intent", hookToken, {
      candidates: [],
    }).then((r) => r.json())) as { ok: boolean; reason?: string };
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_watch");
  });
});
