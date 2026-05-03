import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";

function asUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject });
}

async function createCreator(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email = `${subject}@example.com`
) {
  const user = asUser(t, subject);
  const account = await user.mutation(
    api.creatorMayaV0.backend.getOrCreateAccount,
    {
      email,
      timezone: "America/New_York",
      tier: "starter",
    }
  );
  return { user, account };
}

describe("Creator Maya v0 media assets", () => {
  it("ingests creator media once per creator and dedupes by content hash", async () => {
    const t = convexTest(schema, modules);
    const { user } = await createCreator(t, "creator-media-a");

    const first = await user.mutation(
      api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset,
      {
        storageUrl: "https://cdn.example.com/a.jpg",
        storageBytes: 1000,
        mimeType: "image/jpeg",
        mediaKind: "image",
        source: "imessage",
        sourceMessageId: "msg_1",
        sourcePhoneNumber: "+15555550123",
        filename: "raw.jpg",
        width: 1080,
        height: 1920,
        contentHash: "hash-a",
        consentText: "Can you edit this for TikTok?",
        nowMs: 1,
      }
    );
    const second = await user.mutation(
      api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset,
      {
        storageUrl: "https://cdn.example.com/a-copy.jpg",
        storageBytes: 1000,
        mimeType: "image/jpeg",
        mediaKind: "image",
        source: "imessage",
        contentHash: "hash-a",
        nowMs: 2,
      }
    );

    expect(second).toEqual({
      mediaAssetId: first.mediaAssetId,
      deduped: true,
    });

    const rows = await user.query(
      api.creatorMayaV0.mediaAssets.listMyMediaAssets,
      {}
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].catalog.primarySubject).toBe("[uncataloged]");
    expect(rows[0].consent.usage).toBe("unknown");
  });

  it("keeps the same media hash isolated across creators", async () => {
    const t = convexTest(schema, modules);
    const a = await createCreator(t, "creator-media-hash-a");
    const b = await createCreator(t, "creator-media-hash-b");

    const first = await a.user.mutation(
      api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset,
      {
        storageUrl: "https://cdn.example.com/a.mov",
        storageBytes: 4000,
        mimeType: "video/quicktime",
        mediaKind: "video",
        source: "imessage",
        durationMs: 7000,
        contentHash: "same-hash",
      }
    );
    const second = await b.user.mutation(
      api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset,
      {
        storageUrl: "https://cdn.example.com/b.mov",
        storageBytes: 4000,
        mimeType: "video/quicktime",
        mediaKind: "video",
        source: "imessage",
        durationMs: 7000,
        contentHash: "same-hash",
      }
    );

    expect(second.mediaAssetId).not.toBe(first.mediaAssetId);
    expect(second.deduped).toBe(false);
  });

  it("requires durable storage before registering creator media", async () => {
    const t = convexTest(schema, modules);
    const { user } = await createCreator(t, "creator-media-storage");

    await expect(
      user.mutation(api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset, {
        storageBytes: 1000,
        mimeType: "image/png",
        mediaKind: "image",
        source: "imessage",
        contentHash: "no-storage",
      })
    ).rejects.toThrow("requires at least one of storageId or storageUrl");
  });

  it("records consent and creates edit requests only for owned assets", async () => {
    const t = convexTest(schema, modules);
    const a = await createCreator(t, "creator-media-owner");
    const b = await createCreator(t, "creator-media-other");

    const owned = await a.user.mutation(
      api.creatorMayaV0.mediaAssets.ingestCreatorMediaAsset,
      {
        storageUrl: "https://cdn.example.com/owned.mp4",
        storageBytes: 8000,
        mimeType: "video/mp4",
        mediaKind: "video",
        source: "imessage",
        durationMs: 9000,
        contentHash: "owned-hash",
        nowMs: 10,
      }
    );

    const consent = await a.user.mutation(
      api.creatorMayaV0.mediaAssets.recordCreatorMediaConsent,
      {
        assetId: owned.mediaAssetId,
        usage: "approved_for_this_request",
        text: "Use this clip for the edit I asked for.",
        nowMs: 20,
      }
    );
    expect(consent?.consent.usage).toBe("approved_for_this_request");

    const edit = await a.user.mutation(
      api.creatorMayaV0.mediaAssets.createEditRequest,
      {
        sourceAssetIds: [owned.mediaAssetId],
        requestText: "Cut this into a 9:16 teaser with captions.",
        targetPlatform: "tiktok",
        editPlan: { aspectRatio: "9:16", hook: "show result first" },
        nowMs: 30,
      }
    );
    expect(edit.editRequestId).toBeDefined();

    await expect(
      b.user.mutation(api.creatorMayaV0.mediaAssets.createEditRequest, {
        sourceAssetIds: [owned.mediaAssetId],
        requestText: "Use someone else's clip",
        targetPlatform: "tiktok",
      })
    ).rejects.toThrow("Creator Maya media asset not found");
  });
});
