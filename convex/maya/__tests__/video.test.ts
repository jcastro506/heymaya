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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  submitRender,
  estimateCredits,
  RENDER_JOB_KIND,
  CREDITS_PER_CLONE_SECOND,
  CREDITS_PER_LINK,
  DEFAULT_MODEL,
  MODEL_VERSIONS,
  collectVerdict,
  looksLikeVideo,
  COLLECT_MAX_POLLS,
  COLLECT_INTERVAL_MS,
} from "../video";
import {
  isDoneStatus,
  isFailedStatus,
} from "../../integrations/creatify/types";
import { buildBrief, type VideoBrief } from "../videoBrief";
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
    /**
     * §3.1 vs §3.2: 12 cr/5s against 5 cr/30s — 14x, and the reason the doc
     * says a clone is affordable "once a month" rather than daily.
     *
     * ⚠️ Compared on the RENDER portion. Both paths also spend 1 credit on the
     * Link, and that flat add dilutes the ratio at short lengths — an earlier
     * version of this test compared totals and started failing the moment the
     * Link was counted, which is the test noticing a real change in the
     * arithmetic rather than a regression.
     */
    const clone = estimateCredits("ad_clone", 15) - CREDITS_PER_LINK;
    const url = estimateCredits("avatar", 15) - CREDITS_PER_LINK;
    expect(clone).toBeGreaterThan(url * 10);
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

describe("which model, and what it costs", () => {
  /**
   * ⭐ Verified against docs.creatify.ai/billing.md on 2026-08-17:
   * standard 5cr/30s · aurora_v1_fast 0.5cr/s · aurora_v1 1cr/s. At API Pro
   * ($299 / 2,000 cr = $0.1495) a 30-second video is $0.75 · $2.24 · $4.49.
   *
   * ⚠️ `model_version` was never passed, so a 6× cost spread was decided by
   * whatever the vendor defaults to. A cost that moves when someone else
   * changes a default is not a cost anyone is managing.
   */
  it("⭐ always states the model — never the vendor's default", async () => {
    const d = deps();
    await submitRender(brief(), d);
    expect(d.createLinkToVideo.mock.calls[0][0].model_version).toBe("standard");
  });

  it("⭐ defaults to standard, and the reason is authenticity not money", () => {
    /**
     * §7.5.3's ladder is founder footage → real screen recording → AVATAR LAST,
     * and Aurora buys avatar realism. Paying 6× to make the least authentic
     * rung more convincing is spending more to move DOWN the ladder.
     */
    expect(DEFAULT_MODEL).toBe("standard");
    expect(MODEL_VERSIONS[DEFAULT_MODEL].name).toBe("standard");
  });

  it("⭐ prices the three models at their documented rates", () => {
    // 30s: 5cr + 1 link · 15cr + 1 · 30cr + 1
    expect(estimateCredits("avatar", 30, "standard")).toBe(6);
    expect(estimateCredits("avatar", 30, "aurora_fast")).toBe(16);
    expect(estimateCredits("avatar", 30, "aurora")).toBe(31);
  });

  it("⚠️ counts the Link, which every render spends", () => {
    /**
     * Only 1 credit, but spent on EVERY render. A gate that checks the render
     * against the allowance while quietly spending outside it drifts by one per
     * video — and at the boundary that is the difference between the month's
     * last video working and failing AFTER the founder said yes, which §7.5.7
     * calls the worst possible sequence.
     */
    expect(estimateCredits("avatar", 30, "standard")).toBe(
      Math.ceil((5 / 30) * 30) + CREDITS_PER_LINK
    );
  });

  it("⚠️ aurora is 6x standard, so the choice is a real one", () => {
    const std = estimateCredits("avatar", 30, "standard") - CREDITS_PER_LINK;
    const aurora = estimateCredits("avatar", 30, "aurora") - CREDITS_PER_LINK;
    expect(aurora / std).toBe(6);
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

/* -------------------------------------------------------------------------- */

describe("the founder's yes actually starts the render", () => {
  /**
   * ⚠️ SHIPPED BROKEN AND CAUGHT BY THE OPERATOR ASKING. `runRender` existed,
   * `approveRender` made the job claimable, and `HANDLED_KINDS` did not list
   * the kind — so a "go" would set the job runnable, the queue would claim it,
   * and it would fail with `no handler for job kind "render_video" in this
   * build`.
   *
   * The worst possible shape: every free step worked perfectly and the paid
   * step died. §7.5.7's argument is that failing after a yes is the worst
   * sequence, and this managed it without a vendor being involved at all.
   */
  it("⭐ the queue knows how to run a render", async () => {
    const { HANDLED_KINDS } = await import("../scheduler");
    expect(HANDLED_KINDS.has(RENDER_JOB_KIND)).toBe(true);
  });

  it("⚠️ every kind the product enqueues has a handler", async () => {
    /**
     * The general form of the same bug. A kind that is enqueued but unhandled
     * fails on claim, which looks like a vendor problem and isn't — the
     * sibling-file coherence category, one layer out.
     */
    const { HANDLED_KINDS } = await import("../scheduler");
    for (const kind of ["deliver_message", "publish_placement", RENDER_JOB_KIND]) {
      expect(HANDLED_KINDS.has(kind), `${kind} has no handler`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the render actually comes back", () => {
  /**
   * ⚠️ THE LOOP WAS OPEN AND EVERY TEST PASSED. `submitRender` was covered end
   * to end, `getLinkToVideo`/`getAdClone` were written and called from nowhere,
   * and `vendorJobId` was returned and read by nothing outside this file. The
   * suite proved the expensive half started and never that it finished — which
   * is the exact shape of every failure in this product's history.
   */
  /**
   * ⚠️ THIS TEST USED TO STUB ITS OWN MATCHERS, and stubbed them with statuses
   * the vendor never emits — `completed`, `succeeded`, `error`. It therefore
   * validated the verdict logic against a fantasy vendor and would have passed
   * even if the real helpers were broken. It now calls the REAL ones.
   *
   * Canonical lifecycle, per docs/CREATIFY_API_REFERENCE.md line 27:
   *   pending → in_queue → running → done | failed   (+ `rejected` on Aurora)
   * The doc is explicit that there is NO `rendering` / `completed` / `error`
   * string, so those must never appear in a fixture here again.
   */
  const done = isDoneStatus;
  const failed = isFailedStatus;

  it("⭐ a finished job yields the video URL", () => {
    const v = collectVerdict(
      { status: "done", video_output: "https://cdn/v.mp4", credits_used: 6 },
      done,
      failed
    );
    expect(v.state).toBe("done");
    if (v.state === "done") {
      expect(v.videoUrl).toBe("https://cdn/v.mp4");
      expect(v.creditsUsed).toBe(6);
    }
  });

  it("⭐ an unfinished job keeps polling rather than declaring anything", () => {
    // The three documented non-terminal states, verbatim from the reference.
    for (const status of ["pending", "in_queue", "running"]) {
      expect(collectVerdict({ status }, done, failed).state).toBe("pending");
    }
  });

  it("⚠️ done-with-no-video is a FAILURE, not pending", () => {
    /**
     * Otherwise it polls until the attempt budget runs out and reports a
     * timeout — sending whoever debugs it at latency instead of at the empty
     * field the vendor actually returned.
     */
    const v = collectVerdict({ status: "done", video_output: "" }, done, failed);
    expect(v.state).toBe("failed");
    if (v.state === "failed") expect(v.detail).toMatch(/no video/i);
  });

  it("⚠️ a vendor failure reaches us with its reason, and no vendor name", () => {
    const v = collectVerdict(
      { status: "failed", failed_reason: "source video too short" },
      done,
      failed
    );
    expect(v.state).toBe("failed");
    if (v.state === "failed") {
      expect(v.detail).toContain("too short");
      expect(v.detail).not.toMatch(/creatify|api key|credential/i);
    }
  });

  it("⚠️ the poll budget is bounded — it never asks forever", () => {
    // 40 x 15s = 10 min, ~4x the vendor's ~2.5 min render. Past it the job
    // takes a named failure rather than being reaped as an infra fault.
    expect(COLLECT_MAX_POLLS).toBeGreaterThan(10);
    expect(COLLECT_MAX_POLLS * COLLECT_INTERVAL_MS).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe("what came back is actually a video", () => {
  /**
   * ⚠️ Same lesson media.ts learned on images: an SSO redirect or a JSON error
   * page stored as .mp4 publishes as a broken video, and that surfaces on the
   * platform hours later in the founder's feed rather than here.
   */
  const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);

  it("⭐ accepts mp4 and webm by magic bytes", () => {
    expect(looksLikeVideo(mp4)).toBe("video/mp4");
    expect(looksLikeVideo(webm)).toBe("video/webm");
  });

  it("⚠️ rejects an error page dressed as a video", () => {
    const json = new Uint8Array([...'{"error":"nope"}'].map((c) => c.charCodeAt(0)));
    expect(looksLikeVideo(json)).toBeNull();
    expect(looksLikeVideo(new Uint8Array([1, 2]))).toBeNull();
  });
});

describe("the vendor's real status lifecycle", () => {
  /**
   * ⭐ Pinned against docs/CREATIFY_API_REFERENCE.md line 27, which is the
   * source of truth for `convex/integrations/creatify/`. If the vendor changes
   * its lifecycle, this is where it should hurt — not in production, hours
   * later, with a job stuck `running` until the deadline sweep reaps it.
   */
  it("⭐ treats every documented terminal status as terminal", () => {
    expect(isDoneStatus("done")).toBe(true);
    expect(isFailedStatus("failed")).toBe(true);
    // Aurora and custom-avatar jobs also emit this one.
    expect(isFailedStatus("rejected")).toBe(true);
  });

  it("⚠️ never treats an in-flight status as finished", () => {
    /**
     * The expensive direction of the bug: calling a running job "done" reads
     * `video_output` while it is still null, which `collectVerdict` turns into
     * a failure — so a render that was going to succeed is abandoned after
     * being paid for.
     */
    for (const status of ["pending", "in_queue", "running"]) {
      expect(isDoneStatus(status)).toBe(false);
      expect(isFailedStatus(status)).toBe(false);
    }
  });

  it("⚠️ a rejected job fails rather than polling to the budget", () => {
    const v = collectVerdict(
      { status: "rejected", failed_reason: "avatar not approved" },
      isDoneStatus,
      isFailedStatus
    );
    expect(v.state).toBe("failed");
  });
});

describe("what a video was made of survives the render", () => {
  /**
   * ⚠️ BOTH FACTS WERE COMPUTED AND THROWN AWAY. `planAssets()` decided which
   * rung built a video and `credits_used` came back on the vendor job — the
   * first went onto the BRIEF (which is not kept) and the second was read by
   * nothing. So the most useful thing about a video that underperformed — did
   * it show the founder's real product or a generated presenter — existed for
   * the length of one function call.
   *
   * ⚠️ AND THEY BELONG ON THE ASSET, NOT THE PLACEMENT. A video is made once
   * and posted to three channels; the same three facts on three placement rows
   * would triplicate and drift.
   */
  it("⭐ the brief carries the rung that built it", () => {
    const built = buildBrief({
      rung: "avatar",
      ideaId: "idea_1" as never,
      script: "Paste the CSV. That's it.",
      lines: ["one", "two"],
      assets: [
        { assetId: "a1" as never, url: "https://cdn/1.png" },
        { assetId: "a2" as never, url: "https://cdn/2.png" },
      ],
      hasProductTruth: true,
      assetNote: "building from a screen recording",
      builtFrom: "screen_recording",
      usesAvatar: false,
    });
    expect(built.ok).toBe(true);
    expect(built.brief?.builtFrom).toBe("screen_recording");
    expect(built.brief?.usesAvatar).toBe(false);
  });

  it("⚠️ the verdict is CARRIED through the poll, never recomputed", () => {
    /**
     * `collectRender` takes `builtFrom`/`usedAvatar` as arguments rather than
     * recomputing them when the render finishes. Recomputing would read the
     * library as it is at COLLECTION time — so a screenshot the founder
     * uploaded mid-render would rewrite what the video was actually built from,
     * and the record would describe a video that was never made.
     */
    const src = readFileSync(
      join(process.cwd(), "convex/maya/video.ts"),
      "utf8",
    );
    const args = /export const collectRender[\s\S]*?args: \{([\s\S]*?)\n  \},/.exec(src);
    expect(args, "collectRender args not found").toBeTruthy();
    expect(args![1]).toContain("builtFrom");
    expect(args![1]).toContain("usedAvatar");
    // And it must not call planAssets at collection time.
    const body = /export const collectRender[\s\S]*?\n\}\);/.exec(src)![0];
    expect(body).not.toContain("planAssets");
  });

  it("⭐ the real credit cost is recorded, not the estimate", () => {
    /**
     * `estimateCredits` is the prediction the gate spends against;
     * `verdict.creditsUsed` is what the vendor actually charged. Recording the
     * estimate would make cost-per-result a restatement of our own guess.
     */
    const src = readFileSync(
      join(process.cwd(), "convex/maya/video.ts"),
      "utf8",
    );
    expect(src).toMatch(/renderCredits:\s*verdict\.creditsUsed/);
  });
});
