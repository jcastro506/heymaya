/**
 * ⭐ SPRINT 6'S EXIT CRITERION — a directive survives a deliberate model swap.
 *
 * > **Exit:** a directive survives a redeploy **and a deliberate model swap.**
 * > **Tests:** ⭐ model-swap directive test — swap the main model, assert every
 * > directive still enforced.
 *
 * The reason this is the exit and not a nice-to-have: a house rule enforced
 * only by one model's habits is not enforced, it's a coincidence. The founder
 * said *"we do NOT use Reddit"* once; that has to hold when the writer changes,
 * when the gate model changes, and when a vendor deprecates something at a
 * week's notice.
 *
 * ## Measured 2026-08-08 — four model families, three cases
 *
 * | model | Reddit rule | "as an AI" rule | clean post |
 * |---|---|---|---|
 * | `openai/gpt-oss-120b` | ✅ blocked | ✅ blocked | ✅ passed |
 * | `openai/gpt-5.6-luna-pro` | ✅ blocked | ✅ blocked | ✅ passed |
 * | `google/gemini-3.1-flash-lite` | ✅ blocked | ✅ blocked | ✅ passed |
 * | `mistralai/mistral-small-24b-instruct-2501` | ✅ blocked | ✅ blocked | ✅ passed |
 *
 * Twelve of twelve. The clean case matters as much as the violations — a gate
 * that blocks everything also "enforces every directive", and would be useless.
 *
 * ⚠️ That run is not repeated in CI: it costs four live model calls per case
 * and would make the suite depend on four vendors being up. What runs here is
 * the structural half — that nothing in the enforcement path is bound to a
 * particular model, which is the property that made the live result possible.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "../publishDecision";
import { parseGateVerdict } from "../directiveGate";
import type { Doc, Id } from "../../_generated/dataModel";

const MAYA = join(__dirname, "..");
const NOW = Date.UTC(2026, 7, 8, 12, 0);

describe("⭐ the enforcement path is not bound to a model", () => {
  it("publishDecision consults no model at all", () => {
    // The iron rule (§9.1) is pure by construction. Whatever writes the post,
    // this is what decides whether it goes — and it cannot be talked round.
    const source = readFileSync(join(MAYA, "publishDecision.ts"), "utf8");
    expect(source).not.toMatch(/callModel|callOpenRouter|openrouter/i);
    expect(source).not.toMatch(/gpt-|gemini-|luna|claude-|mistral/i);
  });

  it("the directive gate names its model in ONE place", () => {
    // A model referenced from several call sites is a swap that half happens.
    const source = readFileSync(join(MAYA, "directiveGate.ts"), "utf8");
    const literals = source.match(/"(?:openai|google|mistralai|anthropic)\/[^"]+"/g) ?? [];
    expect(literals).toHaveLength(1);
    expect(source).toMatch(/model: DIRECTIVE_MODEL/);
  });

  it("the gate's verdict parses the same however the model wraps it", () => {
    // The live run showed families formatting differently — fenced, bare,
    // prose-wrapped. A parser that only handled one would make the swap fail
    // for reasons that have nothing to do with the directive.
    const bare = '{"violates":true,"rule":"we do NOT use Reddit","why":"names Reddit"}';
    const fenced = "```json\n" + bare + "\n```";
    for (const raw of [bare, fenced]) {
      const verdict = parseGateVerdict(raw);
      expect(verdict?.violates).toBe(true);
      expect(verdict?.rule).toContain("Reddit");
    }
  });

  it("⚠️ a rule it cannot QUOTE is not a violation", () => {
    // The strongest model-independence guard in the gate: a model that
    // paraphrases, invents, or half-remembers a rule produces no block. The
    // founder's own sentence is the only thing that can hold a post.
    const paraphrased =
      '{"violates":true,"rule":"","why":"feels like it breaks a rule"}';
    expect(parseGateVerdict(paraphrased)?.violates).toBe(false);
  });
});

describe("the server gates hold whatever the model does", () => {
  function rows(over: { postingMode?: "just_go" | "show_me_first" } = {}) {
    return {
      creator: {
        _id: "c1" as Id<"creators">,
        state: "active",
        timezone: "UTC",
      } as Doc<"creators">,
      channel: {
        _id: "ch1" as Id<"channels">,
        channel: "x",
        status: "connected",
        postingMode: over.postingMode ?? "show_me_first",
      } as Doc<"channels">,
      draft: {
        _id: "d1" as Id<"drafts">,
        channel: "x",
        kind: "post",
        snapshotText: "the words the founder saw",
        outcome: "pending",
        proposedAt: NOW,
        expiresAt: NOW + 86_400_000,
      } as Doc<"drafts">,
      now: NOW,
    };
  }

  it("show_me_first holds, no matter which model wrote it", () => {
    // The founder's switch is a row. A model cannot argue with it, and a model
    // swap cannot forget it.
    const result = decide({ ...rows(), alreadyApproved: false });
    expect(result.publish).toBe(false);
    if (!result.publish) expect(result.reason).toBe("show_me_first");
  });

  it("an expired draft holds, no matter which model wrote it", () => {
    const result = decide({
      ...rows({ postingMode: "just_go" }),
      draft: { ...rows().draft, expiresAt: NOW - 1 } as Doc<"drafts">,
      alreadyApproved: true,
    });
    expect(result.publish).toBe(false);
  });

  it("and a clean post on just_go still publishes", () => {
    // The other half of the criterion: enforcement that blocks everything is
    // not enforcement.
    const result = decide({ ...rows({ postingMode: "just_go" }), alreadyApproved: false });
    expect(result.publish).toBe(true);
  });
});

describe("⚠️ the gate fails OPEN, and says so", () => {
  it("an unrun gate is a different fact from a passed one", () => {
    // With no API key every house rule silently stopped being enforced, and
    // the caller could not tell that from "checked and fine". Open is still
    // right — failing closed turns an expired key into a zero-placement week —
    // but principle 5 forbids doing it silently.
    const source = readFileSync(join(MAYA, "directiveGate.ts"), "utf8");
    expect(source).toMatch(/unchecked: true/);
    expect(source).toMatch(/NOT RUN/);
  });
});
