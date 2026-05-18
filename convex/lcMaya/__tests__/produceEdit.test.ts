import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  _setVideoSynthClientForTests,
  type SynthesizeWorkerResponse,
} from "../../integrations/videoSynthWorker/client";

const NOW = 1_780_000_000_000;

function workerResp(content: string): SynthesizeWorkerResponse {
  return {
    content,
    model: "gemini-3-flash-preview",
    usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
    diagnostics: {
      videosRequested: 2,
      videosDownloaded: 2,
      videosUploaded: 2,
      skippedVideos: [],
      totalElapsedMs: 10,
      downloadElapsedMs: 3,
      uploadElapsedMs: 3,
      geminiElapsedMs: 4,
    },
  };
}

const VALID_EDL = JSON.stringify({
  targetDurationSec: 15,
  opener: {
    clipId: "c1",
    inSec: 0,
    outSec: 2,
    why: "motion-first cold open — their highest-lift hook shape",
  },
  segments: [
    { clipId: "c1", inSec: 0, outSec: 2, transition: "cut" },
    { clipId: "c2", inSec: 3, outSec: 6, transition: "cut" },
  ],
  captions: [],
  rationale: [
    {
      choice: "opened on the fountain motion shot",
      evidenceCited: "topHooks: motion-first cold open, 4.2x lift",
    },
  ],
});

async function seedCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; withPicture: boolean }
): Promise<Id<"creators">> {
  const creatorId = await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@t.com`,
      channelPreference: "imessage",
      timezone: "America/New_York",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    })
  );
  if (opts.withPicture) {
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorPicture", {
        creatorId,
        niche: "NYC observational lifestyle",
        audience: { ageRanges: ["18-24"], topGeos: ["US"], interestTags: [] },
        voiceFingerprint: "deadpan, dry, urban",
        topHooks: [
          {
            pattern: "motion-first cold open",
            examplePostId: "p1",
            platform: "tiktok",
            avgPerformanceLift: 4.2,
          },
        ],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "gemini-3-flash-preview",
        sourceCitations: [],
      });
    });
  }
  return creatorId;
}

async function seedClip(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  n: number
): Promise<Id<"creatorMayaV0MediaAssets">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("creatorMayaV0MediaAssets", {
      creatorId,
      storageUrl: `https://x/c${n}.mp4`,
      storageBytes: 1024,
      mimeType: "video/mp4",
      mediaKind: "video",
      source: "openclaw_attachment",
      contentHash: `hash-${creatorId}-${n}`,
      consent: { usage: "approved_for_this_request" },
      catalog: {
        primarySubject: `clip ${n}`,
        visualQuality: "good",
        creatorRelevance: "on-lane",
        suggestedUses: ["stitch"],
        catalogedAt: NOW,
        catalogModel: "test",
        catalogCostUsd: 0,
      },
      usageHistory: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function clipsFor(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">
): Promise<Array<{ clipId: string; mediaAssetId: Id<"creatorMayaV0MediaAssets"> }>> {
  return [
    { clipId: "c1", mediaAssetId: await seedClip(t, creatorId, 1) },
    { clipId: "c2", mediaAssetId: await seedClip(t, creatorId, 2) },
  ];
}

describe("produceEditInternal", () => {
  afterEach(() => _setVideoSynthClientForTests(null));

  it("happy path: valid EDL from the worker is parsed + returned", async () => {
    _setVideoSynthClientForTests(async () => workerResp(VALID_EDL));
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "ok", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "make a fun TikTok about NYC waking up",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("guard");
    expect(r.edl.segments).toHaveLength(2);
    expect(r.edl.opener.clipId).toBe("c1");
    expect(r.edl.rationale[0].evidenceCited).toMatch(/motion-first/);
  });

  it("strips code fences before parsing", async () => {
    _setVideoSynthClientForTests(async () =>
      workerResp("```json\n" + VALID_EDL + "\n```")
    );
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "fence", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(true);
  });

  it("no clips → no-clips", async () => {
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "nc", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("no-clips");
  });

  it("no creatorPicture → no-picture (can't condition an edit)", async () => {
    _setVideoSynthClientForTests(async () => workerResp(VALID_EDL));
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "np", withPicture: false });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("no-picture");
  });

  it("worker returns non-JSON → model-malformed", async () => {
    _setVideoSynthClientForTests(async () =>
      workerResp("here is your edit, opened on the fountain...")
    );
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "mm", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("model-malformed");
  });

  it("worker returns JSON failing the EDL schema → edl-invalid", async () => {
    _setVideoSynthClientForTests(async () =>
      workerResp(JSON.stringify({ targetDurationSec: 15 }))
    );
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "ei", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("edl-invalid");
  });

  it("EDL references a clipId not in the input → edl-invalid (no invented clips)", async () => {
    const bad = JSON.parse(VALID_EDL);
    bad.segments[1].clipId = "c9";
    _setVideoSynthClientForTests(async () =>
      workerResp(JSON.stringify(bad))
    );
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "ghost", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("edl-invalid");
    expect(r.detail).toMatch(/c9/);
  });

  it("segment with outSec <= inSec → edl-invalid", async () => {
    const bad = JSON.parse(VALID_EDL);
    bad.segments[0].outSec = bad.segments[0].inSec;
    _setVideoSynthClientForTests(async () =>
      workerResp(JSON.stringify(bad))
    );
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "neg", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("edl-invalid");
  });

  it("worker throws → worker-failed (graceful, no throw to caller)", async () => {
    _setVideoSynthClientForTests(async () => {
      throw new Error("worker 502");
    });
    const t = convexTest(schema, modules);
    const cid = await seedCreator(t, { suffix: "wf", withPicture: true });
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: cid,
      brief: "x",
      clips: await clipsFor(t, cid),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("worker-failed");
  });

  it("CROSS-TENANT: creator B cannot edit creator A's clips → clip-not-found", async () => {
    _setVideoSynthClientForTests(async () => workerResp(VALID_EDL));
    const t = convexTest(schema, modules);
    const a = await seedCreator(t, { suffix: "ta", withPicture: true });
    const b = await seedCreator(t, { suffix: "tb", withPicture: true });
    const aClips = await clipsFor(t, a); // assets owned by A
    const r = await t.action(internal.lcMaya.produceEdit.produceEditInternal, {
      creatorId: b, // …requested as B
      brief: "steal A's footage",
      clips: aClips,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("guard");
    expect(r.reason).toBe("clip-not-found");
  });
});
