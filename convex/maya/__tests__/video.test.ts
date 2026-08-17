/**
 * ⭐ Sprint 9's render path, exercised with NO API KEY.
 *
 * `submitRender` takes its vendor calls as dependencies for exactly this
 * reason: the Creatify contract is the risky part, and it is unavailable until
 * a credential and written resale terms exist (CLAUDE.md operator blocker 1).
 * So the calls are asserted against `docs/CREATIFY_API_REFERENCE.md` §3 rather
 * than against a live account, and the day the key lands the only thing that
 * changes is `isCreatifyConfigured()`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  submitRender,
  estimateCredits,
  RENDER_JOB_KIND,
  CREDITS_PER_CLONE_SECOND,
} from "../video";
import type { VideoBrief } from "../videoBrief";
import type { Id } from "../../_generated/dataModel";

const brief = (over: Partial<VideoBrief> = {}): VideoBrief => ({
  rung: "avatar",
  ideaId: "idea_1" as Id<"ideas">,
  scenes: [
    { kind: "broll", still: "https://cdn/1.png", line: "one" },
    { kind: "broll", still: "https://cdn/2.png", line: "two" },
  ],
  script: "Paste the CSV. That's it.",
  length: 30,
  imageUrls: ["https://cdn/1.png", "https://cdn/2.png"],
  ...over,
});

function deps(over: Partial<Parameters<typeof submitRender>[1]> = {}) {
  return {
    isConfigured: () => true,
    createLinkWithParams: vi.fn(async () => ({ id: "link_1" })),
    createAdClone: vi.fn(async () => ({ id: "clone_1" })),
    createLinkToVideo: vi.fn(async () => ({ id: "l2v_1" })),
    ...over,
  } as Parameters<typeof submitRender>[1] & {
    createLinkWithParams: ReturnType<typeof vi.fn>;
    createAdClone: ReturnType<typeof vi.fn>;
    createLinkToVideo: ReturnType<typeof vi.fn>;
  };
}

describe("the render never starts without a key", () => {
  it("⭐ returns a named failure rather than throwing", () => {
    /**
     * §2.5: every job produces a result or a NAMED failure. Throwing here would
     * surface as an unhandled action error the founder sees as silence.
     */
    return submitRender(brief(), deps({ isConfigured: () => false })).then(
      (out) => {
        expect(out.ok).toBe(false);
        expect(out.failure).toBe("vendor_unconfigured");
        // §11 — no vendor name, no credential noun.
        expect(out.detail).not.toMatch(/creatify|api key|token|credential/i);
      }
    );
  });

  it("⚠️ and spends nothing on the way out", async () => {
    const d = deps({ isConfigured: () => false });
    await submitRender(brief(), d);
    // The link call is the first credit (§3.1: 1 cr). It must not happen.
    expect(d.createLinkWithParams).not.toHaveBeenCalled();
    expect(d.createLinkToVideo).not.toHaveBeenCalled();
    expect(d.createAdClone).not.toHaveBeenCalled();
  });
});

describe("the vendor contract, per docs/CREATIFY_API_REFERENCE.md §3", () => {
  it("⭐ ALWAYS grounds the link with our own images", async () => {
    /**
     * §7.6.2 is absolute: never let Creatify scrape. And §7.5.36 makes it the
     * approval step — the founder okayed OUR frames, so rendering against a
     * vendor scrape would make the storyboard a lie.
     */
    const d = deps();
    await submitRender(brief(), d);
    expect(d.createLinkWithParams).toHaveBeenCalledTimes(1);
    expect(d.createLinkWithParams.mock.calls[0][0].image_urls).toEqual([
      "https://cdn/1.png",
      "https://cdn/2.png",
    ]);
  });

  it("⭐ the avatar rung passes OUR script — HYBRID, not AUTO", async () => {
    /**
     * §3.2: omitting `override_script` is AUTO mode, where Creatify writes the
     * words. The words are where an unsupported claim comes from, and §2.7
     * makes that ours to control.
     */
    const d = deps();
    const out = await submitRender(brief(), d);
    expect(out.ok).toBe(true);
    expect(out.vendorJobId).toBe("l2v_1");

    const body = d.createLinkToVideo.mock.calls[0][0];
    expect(body.link).toBe("link_1");
    expect(body.override_script).toBe("Paste the CSV. That's it.");
    expect(body.aspect_ratio).toBe("9x16");
    expect(body.video_length).toBe(30);
    // The clone endpoint is a different, far more expensive rung.
    expect(d.createAdClone).not.toHaveBeenCalled();
  });

  it("⭐ the clone rung recreates a proven shape against the same link", async () => {
    const d = deps();
    const out = await submitRender(
      brief({ rung: "ad_clone", referenceVideoUrl: "https://tiktok/winner" }),
      d
    );
    expect(out.ok).toBe(true);
    expect(out.vendorJobId).toBe("clone_1");

    const body = d.createAdClone.mock.calls[0][0];
    expect(body.link).toBe("link_1");
    expect(body.video_url).toBe("https://tiktok/winner");
    expect(body.aspect_ratio).toBe("9x16");
    expect(d.createLinkToVideo).not.toHaveBeenCalled();
  });

  it("⚠️ a clone with nothing to clone is a named failure, not a guess", async () => {
    const d = deps();
    const out = await submitRender(brief({ rung: "ad_clone" }), d);
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("vendor_failed");
    expect(d.createAdClone).not.toHaveBeenCalled();
  });

  it("⚠️ a vendor error is reported, never swallowed", async () => {
    const d = deps({
      createLinkToVideo: vi.fn(async () => {
        throw new Error("429 Too Many Requests");
      }),
    });
    const out = await submitRender(brief(), d);
    expect(out.ok).toBe(false);
    expect(out.failure).toBe("vendor_failed");
    expect(out.detail).toContain("429");
  });
});

describe("what a render is estimated to cost", () => {
  it("prices the clone rung far above the URL path", () => {
    // §3.1 vs §3.2: 12 cr/5s against 5 cr/30s — 14x, and the reason the doc
    // says a clone is affordable "once a month" rather than daily.
    expect(estimateCredits("ad_clone", 15)).toBeGreaterThan(
      estimateCredits("avatar", 15) * 10
    );
    expect(CREDITS_PER_CLONE_SECOND).toBeCloseTo(2.4, 5);
  });

  it("⚠️ never returns a fractional credit", () => {
    // Credits are whole units at the vendor; a fractional estimate compared
    // against a whole-number allowance rounds the wrong way at the boundary.
    for (const len of [15, 30, 45, 60]) {
      expect(Number.isInteger(estimateCredits("avatar", len))).toBe(true);
      expect(Number.isInteger(estimateCredits("ad_clone", len))).toBe(true);
    }
  });
});

describe("the job kind the budget can actually see", () => {
  it("⭐ matches what checkVideoBudget counts", () => {
    /**
     * ⚠️ The sibling-file coherence bug this pins. `planFeatures.checkVideoBudget`
     * counts the month's usage with `row.kind === "render_video"`. A different
     * string here would render videos the budget could not see — the allowance
     * would read zero-used forever while credits drained, and the only symptom
     * would be the bill.
     */
    expect(RENDER_JOB_KIND).toBe("render_video");
  });
});
