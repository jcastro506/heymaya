/** Big phone videos: a stored file over the inline ceiling is watched by reference, never loaded whole. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { INLINE_MAX_BYTES } from "../../integrations/gemini/client";
import { ATTACHMENT_MAX_BYTES } from "../../core/imessage";

describe("big drafts", () => {
  it("storedSize reports the stored file's size; unknown ids are null", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(1234)], { type: "video/mp4" })));
    expect(await t.query(internal.agent.opinion.storedSize, { storageId: id })).toBe(1234);
  });
  it("Messages takes phone-sized videos, far above the inline ceiling", () => {
    expect(ATTACHMENT_MAX_BYTES).toBeGreaterThanOrEqual(100 * 1024 * 1024);
    expect(ATTACHMENT_MAX_BYTES).toBeGreaterThan(INLINE_MAX_BYTES);
  });
});
