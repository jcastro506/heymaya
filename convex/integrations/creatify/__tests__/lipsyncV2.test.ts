/**
 * Creatify lipsync_v2 — request-shape tests.
 *
 * Spec defect 8: "Creatify's 28 endpoint wrappers are untested — the two least
 * verified paths are the ones that spend money." This covers the one that
 * matters most, because `lipsync_v2` is the flagship UGC format AND it is
 * billed per second (0.5 cr/sec on `aurora_v1_fast`). A malformed scene array
 * doesn't fail cheaply — it either burns credits on a wrong render or gets
 * rejected after we've already told the founder it's coming.
 *
 * No Creatify key exists in this environment, so these assert the REQUEST WE
 * BUILD, not the response we get. That's the half we control and the half that
 * causes the expensive mistakes. Response shape is the smoke suite's job
 * (§18.0.5) once a key exists.
 */

import { describe, it, expect, vi } from "vitest";
import { CreatifyClient } from "../client";
import { createLipsyncV2, getRemainingCredits, getPersonasV2 } from "../endpoints";

function clientCapturing(response: unknown = { id: "job-1", status: "pending" }) {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  const client = new CreatifyClient({
    apiId: "test-id",
    apiKey: "test-key",
    baseUrl: "https://api.example-creatify.test",
    sleep: async () => {},
  });
  // The client binds fetch at construction in some paths; inject explicitly.
  (client as unknown as { fetchImpl: typeof fetch }).fetchImpl =
    fetchImpl as unknown as typeof fetch;
  return { client, fetchImpl };
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const AVATAR = "avatar_abc123";

describe("createLipsyncV2 — the scene array", () => {
  it("an avatar scene carries an EXPLICIT avatar_id", async () => {
    // Creatify does NOT pick an avatar for us. v2 scenes require an explicit
    // id, so a scene that reaches the API without one is a wasted call.
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          {
            character: { type: "avatar", avatar_id: AVATAR },
            voice: { type: "text", input_text: "here's what broke" },
          },
        ],
      },
      client
    );
    const body = bodyOf(fetchImpl);
    const scenes = body.video_inputs as Array<Record<string, unknown>>;
    expect((scenes[0].character as Record<string, unknown>).avatar_id).toBe(AVATAR);
  });

  it("posts to /api/lipsyncs_v2/ and defaults to 9x16 + the cheap model", async () => {
    // 9x16 is the vertical asset three of four channels take. aurora_v1_fast
    // is 0.5 cr/sec; the non-fast tiers cost materially more.
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          {
            character: { type: "avatar", avatar_id: AVATAR },
            voice: { type: "text", input_text: "hi" },
          },
        ],
      },
      client
    );
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/lipsyncs_v2/");
    const body = bodyOf(fetchImpl);
    expect(body.aspect_ratio).toBe("9x16");
    expect(body.model_version).toBe("aurora_v1_fast");
  });

  it("an explicit aspect ratio and model override the defaults", async () => {
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          { character: { type: "avatar", avatar_id: AVATAR }, voice: { type: "text", input_text: "x" } },
        ],
        aspect_ratio: "16x9",
        model_version: "aurora_v1",
      },
      client
    );
    const body = bodyOf(fetchImpl);
    expect(body.aspect_ratio).toBe("16x9");
    expect(body.model_version).toBe("aurora_v1");
  });

  it("THE SANDWICH: a b-roll scene drops the character but keeps the voice", async () => {
    // The UGC sandwich is avatar → founder's real product footage → avatar,
    // with ONE voice throughout so it reads as a single speaker rather than a
    // montage. A b-roll scene that kept a character would show the avatar over
    // the product shot; one that dropped the voice would go silent mid-video.
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          {
            character: { type: "avatar", avatar_id: AVATAR },
            voice: { type: "text", input_text: "so we rebuilt it" },
          },
          {
            character: null,
            voice: { type: "text", input_text: "and this is the result" },
            background: { type: "video", url: "https://cdn.test/demo.mp4" },
          },
          {
            character: { type: "avatar", avatar_id: AVATAR },
            voice: { type: "text", input_text: "try it" },
          },
        ],
      },
      client
    );
    const scenes = bodyOf(fetchImpl).video_inputs as Array<Record<string, unknown>>;
    expect(scenes).toHaveLength(3);

    // `compact` strips nulls, so a b-roll scene arrives with no character key.
    expect(scenes[1].character).toBeUndefined();
    expect((scenes[1].background as Record<string, unknown>).url).toBe(
      "https://cdn.test/demo.mp4"
    );
    // Every scene still speaks.
    for (const scene of scenes) {
      expect((scene.voice as Record<string, unknown>).input_text).toBeTruthy();
    }
  });

  it("the avatar id is identical across avatar scenes — one person, not two", async () => {
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          { character: { type: "avatar", avatar_id: AVATAR }, voice: { type: "text", input_text: "a" } },
          { character: null, voice: { type: "text", input_text: "b" }, background: { type: "image", url: "https://cdn.test/s.png" } },
          { character: { type: "avatar", avatar_id: AVATAR }, voice: { type: "text", input_text: "c" } },
        ],
      },
      client
    );
    const scenes = bodyOf(fetchImpl).video_inputs as Array<Record<string, unknown>>;
    const ids = scenes
      .map((s) => (s.character as Record<string, unknown> | undefined)?.avatar_id)
      .filter(Boolean);
    expect(new Set(ids).size).toBe(1);
  });

  it("an image background is typed image, a video background typed video", async () => {
    // Sending the wrong type is a render that completes and looks wrong —
    // the most expensive kind of mistake, because it burns the credit AND the
    // founder's trust.
    const { client, fetchImpl } = clientCapturing();
    await createLipsyncV2(
      {
        video_inputs: [
          { character: null, voice: { type: "text", input_text: "a" }, background: { type: "image", url: "https://cdn.test/a.png" } },
          { character: null, voice: { type: "text", input_text: "b" }, background: { type: "video", url: "https://cdn.test/b.mp4" } },
        ],
      },
      client
    );
    const scenes = bodyOf(fetchImpl).video_inputs as Array<Record<string, unknown>>;
    expect((scenes[0].background as Record<string, unknown>).type).toBe("image");
    expect((scenes[1].background as Record<string, unknown>).type).toBe("video");
  });

  it("surfaces the job id so the poller has something to follow", async () => {
    const { client } = clientCapturing({ id: "lip-77", status: "pending" });
    const job = await createLipsyncV2(
      {
        video_inputs: [
          { character: { type: "avatar", avatar_id: AVATAR }, voice: { type: "text", input_text: "x" } },
        ],
      },
      client
    );
    expect(job.id).toBe("lip-77");
  });

  it("a response with no id throws rather than returning a job we can't poll", async () => {
    // Nothing fails silently: an unpollable job is a render we paid for and
    // can never collect.
    const { client } = clientCapturing({ status: "pending" });
    await expect(
      createLipsyncV2(
        {
          video_inputs: [
            { character: { type: "avatar", avatar_id: AVATAR }, voice: { type: "text", input_text: "x" } },
          ],
        },
        client
      )
    ).rejects.toThrow();
  });
});

describe("the free reads that keep spending honest", () => {
  it("getRemainingCredits hits the documented path", async () => {
    // remaining_credits is ground truth over plan math — the "never render
    // blind" rule has no tool without it.
    const { client, fetchImpl } = clientCapturing({ remaining_credits: 1875 });
    const res = await getRemainingCredits(client);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/remaining_credits/");
    expect(res.remaining_credits).toBe(1875);
  });

  it("getPersonasV2 passes the style and gender filters through", async () => {
    // This is how an avatar gets chosen at all — Creatify has no auto-pick.
    const { client, fetchImpl } = clientCapturing([{ id: "p1" }]);
    await getPersonasV2({ style: "selfie", gender: "female" }, client);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toMatch(/style=selfie/);
    expect(url).toMatch(/gender=female/);
  });
});
