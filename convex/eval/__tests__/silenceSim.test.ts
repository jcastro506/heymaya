/**
 * The silence simulation's own promises, without a model: its expectation table is exactly what the
 * policy (`decideReengage` + Linq's phone rail) produces for each scripted person, its verdict function
 * catches every way a run could go wrong, and nothing in it can touch a real creator.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideReengage, COMMITMENT_KINDS, type ReengageInput, type SpellSend } from "../../agent/reengage";
import { phoneRailHold } from "../../core/phoneRail";
import { EXPECTED, eventsFor, judgeRole, ROLES, SL_PREFIX, type Role } from "../silenceSim";

const D = 86_400_000;
const T0 = Date.UTC(2026, 8, 8, 9, 0);

/** Replays a role's script through the real policy and rail, day by day, the way the sim's rows would. */
function replay(role: Role, days = 22): Array<[number, string]> {
  const phone = role.startsWith("phone") || role === "stops_d5";
  let inboundDay: number | null = null, inboundId = "paired", n = 0;
  const ideas: Array<{ day: number; key: string }> = [];
  const said = new Set<string>();
  let hot: number | null = null, optedOut: number | undefined, paused = false;
  const sends: Array<SpellSend & { day: number }> = [];
  const out: Array<[number, string]> = [];
  for (let d = 0; d <= days; d++) {
    for (const e of eventsFor(role, d)) {
      if (e.kind === "inbound" || e.kind === "return") { inboundDay = d; inboundId = `m${++n}`; }
      if (e.kind === "idea") ideas.push({ day: d, key: `reason:ideas:${d}:${ideas.length}` });
      if (e.kind === "hot") hot = d;
      if (e.kind === "optout") { optedOut = T0 + d * D; inboundDay = d; inboundId = `m${++n}`; }
      if (e.kind === "pause") paused = true;
      if (e.kind === "scout") sends.push({ day: d, ts: T0 + d * D, kind: "scout", dedupeKey: `sl:scout:${d}` });
    }
    const now = T0 + d * D + 5 * 60_000;
    const since = inboundDay ?? 0;
    const unseen = ideas.filter((i) => d - i.day <= 7 && i.day >= 0);
    const newest = unseen.at(-1);
    const reasons = [
      ...(newest && !said.has(newest.key) ? [{ kind: "ideas_waiting" as const, key: newest.key, text: "ideas" }] : []),
      ...(hot !== null && hot >= since && d - hot >= 2 && !said.has("reason:post:hot") ? [{ kind: "breakout" as const, key: "reason:post:hot", text: "post" }] : []),
    ];
    const mine = sends.filter((s) => s.day >= since && !(s.day === since && s.kind === undefined));
    const input: ReengageInput = { now, paired: true, optedOutAt: optedOut, lastInboundAt: T0 + since * D, pairedAt: T0, spellId: inboundId, sends: mine, reasons, capability: null };
    const dec = decideReengage(input);
    if (paused || !dec.send) continue; // a paused plan holds every proactive text (checkRails)
    if (phone) {
      const unanswered = mine.filter((s) => !(COMMITMENT_KINDS as readonly string[]).includes(s.kind ?? "")).map((s) => ({ ts: s.ts, kind: s.kind }));
      const held = phoneRailHold({ now, kind: dec.kind, health: undefined, lineState: null, optedOutAt: optedOut, lastInboundAt: T0 + since * D, unanswered, proactiveToday: 0 });
      if (held) continue;
    }
    sends.push({ day: d, ts: now, kind: dec.kind, dedupeKey: dec.dedupeKey });
    for (const r of dec.reasons) said.add(r.key);
    out.push([d, dec.rung]);
  }
  return out;
}

describe("the silence simulation: expectations", () => {
  it("its table is exactly what the policy and the phone rail do for each scripted person", () => {
    for (const role of ROLES) expect(replay(role), role).toEqual(EXPECTED[role]);
  });

  it("covers every promise: silence, the ladder, the rail, an answer, STOP, pause, nothing to say, a return", () => {
    expect(ROLES).toEqual(["phone_silent", "tg_silent", "phone_scout3", "replies_d4", "stops_d5", "no_reasons", "paused_d2", "returns_d12", "returns_busy"]);
    expect(EXPECTED.stops_d5, "nothing after STOP, not even the easy-out").toEqual([[3, "nudge"]]);
    expect(EXPECTED.paused_d2).toEqual([]);
    expect(EXPECTED.no_reasons, "the exit goes even with nothing to say").toEqual([[15, "easy_out"]]);
    expect(EXPECTED.phone_scout3.map(([, r]) => r), "behind three unanswered texts only the exit is left").toEqual(["easy_out"]);
  });
});

describe("the verdict catches every way a run goes wrong", () => {
  const ok = (d: number, rung: string, body = "new one for you: the shoe rack list, said to camera. want it?", reasons = ["2 new ideas in their app; the newest is \"the shoe rack list, said straight to camera\""]) => ({ d, sent: true, rung, body, reasons, judge: { pass: true, note: "" } });
  const clean = () => [ok(3, "nudge"), ok(9, "nudge2"), ok(15, "easy_out", "still here. i'll stop texting so much. say pause and i'll go quiet, or send me anything and i'm right back.", [])];
  const fails = (role: Role, log: ReturnType<typeof clean>) => judgeRole(role, log).filter((c) => !c.ok).map((c) => c.check);

  it("a clean run passes every check", () => expect(fails("phone_silent", clean())).toEqual([]));
  it("a wrong sequence, a missed rung, or a rung too soon fails", () => {
    expect(fails("phone_silent", [ok(3, "nudge"), ok(15, "easy_out", "say pause or send anything", [])])).toContain("the right texts on the right days");
    expect(fails("phone_silent", [ok(3, "nudge"), ok(5, "nudge2"), ok(15, "easy_out", "say pause", [])])).toEqual(expect.arrayContaining(["the right texts on the right days", expect.stringMatching(/about a text a week/)]));
  });
  it("guilt, length, a missing pause, or an ungrounded nudge fails", () => {
    const log = clean();
    log[0].body = "just checking in, it's been a while since we talked";
    expect(fails("phone_silent", log)).toEqual(expect.arrayContaining([`no guilt, no "just checking in"`, "a nudge names the true thing it was given"]));
    const long = clean();
    long[1].body = Array(60).fill("word").join(" ");
    expect(fails("phone_silent", long)).toContain("short enough to be a text");
    const nopause = clean();
    nopause[2].body = "still here, hope training is going well";
    expect(fails("phone_silent", nopause)).toContain("the easy-out says how to pause");
  });
  it("a text after STOP, a text after pausing, or a rail that never fired fails", () => {
    expect(fails("stops_d5", [ok(3, "nudge"), ok(15, "easy_out", "say pause", [])])).toEqual(expect.arrayContaining(["nothing after they said STOP"]));
    expect(fails("paused_d2", [ok(3, "nudge")])).toContain("nothing after they paused");
    expect(fails("phone_scout3", [{ d: 15, sent: true, rung: "easy_out", body: "say pause or send anything", reasons: [], judge: { pass: true, note: "" } }] as never)).toContain("Linq's rail actually held the nudge behind two unanswered texts");
  });
  it("a welcome-back that guilts, or a turn that failed, fails; a judge that wouldn't send it fails (advisory)", () => {
    const base = [ok(3, "nudge"), ok(9, "nudge2"), ok(16, "nudge"), ok(22, "nudge2")] as never[];
    const back = (body: string) => ({ d: 13, result: "welcome-back turn", body, judge: { pass: true, note: "" } });
    expect(fails("returns_d12", [...base, back("hey, there you are! two new ideas waiting in your app")] as never)).toEqual([]);
    expect(fails("returns_d12", [...base, back("where have you been?? it's been a while")] as never)).toContain("a real reply to the person who came back, without guilt");
    expect(fails("returns_d12", [...base, back("(the turn failed: x)")] as never)).toContain("a real reply to the person who came back, without guilt");
    expect(judgeRole("phone_silent", [{ ...ok(3, "nudge"), judge: { pass: false, note: "generic" } }]).find((c) => c.check.includes("judge"))?.ok).toBe(false);
  });
});

describe("the simulation cannot touch a real creator", () => {
  it("every mutation refuses a creator that isn't its own, and the run refuses production", () => {
    const src = readFileSync(new URL("../silenceSim.ts", import.meta.url), "utf8");
    expect(SL_PREFIX).toBe("eval-run:sl-");
    expect(src).toMatch(/only a silence-simulation creator/);
    expect(src).toMatch(/refusing to delete a creator outside the simulation/);
    expect(src).toMatch(/ENVIRONMENT_NAME === "production"/);
    // apply / ageOne / clearPage all go through the guard
    for (const fn of ["export const apply", "export const ageOne", "export const clearPage"]) {
      const body = src.slice(src.indexOf(fn), src.indexOf(fn) + 900);
      expect(body, fn).toMatch(/simCreator\(|isSimSubject\(/);
    }
    expect(src).not.toMatch(/TODO|FIXME/);
  });
});
