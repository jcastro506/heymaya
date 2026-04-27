/**
 * Worker server.test.ts — unit tests for the Express layer.
 *
 * Covers:
 *  - Bearer auth (missing / wrong / right; constant-time-ish)
 *  - Request body validation (missing fields, wrong types, oversized arrays)
 *  - Multimodal parts construction passes through the correct kind markers
 *  - Cleanup runs on success AND on error paths (the spy verifies)
 *
 * No real yt-dlp, no real Gemini. The Gemini SDK is mocked via vi.mock so
 * the worker's gemini.ts builds without contacting Google. The orchestrator
 * is dependency-injected with fake download / upload / generate impls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/server";
import { runSynthesis, type SynthesizeOptions } from "../src/synthesize";

// Avoid importing the real @google/genai SDK in tests. The worker's gemini.ts
// is exercised by separate unit tests; here we focus on the server surface.
vi.mock("@google/genai", () => ({
  GoogleGenAI: class FakeGenAI {
    files = { upload: vi.fn(), get: vi.fn() };
    models = { generateContent: vi.fn() };
  },
  FileState: { PROCESSING: "PROCESSING", ACTIVE: "ACTIVE", FAILED: "FAILED" },
}));

const SECRET = "test-shared-secret-abc-123";

interface PostJsonResult {
  status: number;
  body: unknown;
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<PostJsonResult> {
  return await new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: chunks ? JSON.parse(chunks) : null,
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getJson(port: number, path: string): Promise<PostJsonResult> {
  return await new Promise((resolve, reject) => {
    const req = request.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: chunks ? JSON.parse(chunks) : null,
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

interface BootedServer {
  port: number;
  close: () => Promise<void>;
  callsTo: { runSynthesis: ReturnType<typeof vi.fn> };
}

async function bootServer(opts: {
  runSynthesisImpl?: typeof runSynthesis;
  geminiClient?: unknown;
} = {}): Promise<BootedServer> {
  const runSynthSpy = vi.fn(opts.runSynthesisImpl ?? defaultFakeRunSynth);
  const app = buildApp({
    sharedSecret: SECRET,
    geminiClient: opts.geminiClient ?? ({} as never),
    runSynthesisImpl: runSynthSpy as unknown as typeof runSynthesis,
    log: () => {},
  });
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        callsTo: { runSynthesis: runSynthSpy },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on("error", reject);
  });
}

function defaultFakeRunSynth(): ReturnType<typeof runSynthesis> {
  return Promise.resolve({
    ok: true,
    content: '{"ok":"yes"}',
    model: "gemini-3-flash",
    usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 25 },
    diagnostics: {
      videosRequested: 0,
      videosDownloaded: 0,
      videosUploaded: 0,
      skippedVideos: [],
      totalElapsedMs: 10,
      downloadElapsedMs: 0,
      uploadElapsedMs: 0,
      geminiElapsedMs: 5,
    },
  });
}

function validBody(): unknown {
  return {
    creatorId: "creator_abc",
    systemPrompt: "x".repeat(60),
    userPayloadJson: '{"creator":{},"perPlatform":[]}',
    posts: [
      {
        postId: "tt_post_0",
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/@u/video/123",
        kind: "video",
      },
      {
        postId: "tt_post_1",
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/@u/video/124",
        kind: "text-context",
      },
    ],
    thinkingBudget: "high",
  };
}

beforeEach(() => {
  process.env.GOOGLE_GENAI_API_KEY = "fake-key";
  process.env.WORKER_SHARED_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* /health                                                                     */
/* -------------------------------------------------------------------------- */

describe("/health", () => {
  it("returns 200 when env + tmp dir are configured", async () => {
    const s = await bootServer();
    try {
      const res = await getJson(s.port, "/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        hasGenAiKey: true,
        hasSecret: true,
      });
    } finally {
      await s.close();
    }
  });

  it("returns 503 when GOOGLE_GENAI_API_KEY is missing", async () => {
    delete process.env.GOOGLE_GENAI_API_KEY;
    const s = await bootServer();
    try {
      const res = await getJson(s.port, "/health");
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ ok: false, hasGenAiKey: false });
    } finally {
      await s.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

describe("/synthesize — auth", () => {
  it("rejects request with no Authorization header (401)", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody());
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "missing-bearer" },
      });
      // Body was NOT parsed → orchestrator never invoked.
      expect(s.callsTo.runSynthesis).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("rejects request with wrong bearer (401)", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: "Bearer wrong-secret",
      });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "invalid-bearer" },
      });
      expect(s.callsTo.runSynthesis).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("rejects request with malformed Authorization (Basic instead of Bearer)", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: "Basic dXNlcjpwYXNz",
      });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "missing-bearer" },
      });
    } finally {
      await s.close();
    }
  });

  it("accepts request with the correct bearer", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, content: '{"ok":"yes"}' });
      expect(s.callsTo.runSynthesis).toHaveBeenCalledTimes(1);
    } finally {
      await s.close();
    }
  });

  it("rejects bearer of different length (length-leak prevention)", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}xx`, // longer than secret
      });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "invalid-bearer" },
      });
    } finally {
      await s.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Body validation                                                             */
/* -------------------------------------------------------------------------- */

describe("/synthesize — body validation", () => {
  it("rejects body without creatorId", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as Record<string, unknown>;
      delete body.creatorId;
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "bad-request" },
      });
      expect(s.callsTo.runSynthesis).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("rejects body with non-array posts", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as Record<string, unknown>;
      body.posts = "not-an-array";
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it("rejects body with invalid videoUrl", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as { posts: Array<{ videoUrl: string }> };
      body.posts[0].videoUrl = "not-a-url";
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it("rejects body with invalid kind enum value", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as { posts: Array<{ kind: string }> };
      body.posts[0].kind = "audio-only";
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it("rejects body with invalid thinkingBudget", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as { thinkingBudget: string };
      body.thinkingBudget = "extreme";
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it("rejects body with too-short systemPrompt", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as { systemPrompt: string };
      body.systemPrompt = "short";
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });

  it("rejects body with > 150 posts (oversized)", async () => {
    const s = await bootServer();
    try {
      const body = validBody() as { posts: unknown[] };
      body.posts = Array.from({ length: 151 }, (_, i) => ({
        postId: `p_${i}`,
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/x",
        kind: "text-context",
      }));
      const res = await postJson(s.port, "/synthesize", body, {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(400);
    } finally {
      await s.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Orchestrator integration                                                    */
/* -------------------------------------------------------------------------- */

describe("/synthesize — orchestrator pass-through", () => {
  it("forwards parsed body to runSynthesis verbatim", async () => {
    const s = await bootServer();
    try {
      await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}`,
      });
      expect(s.callsTo.runSynthesis).toHaveBeenCalledOnce();
      const [parsed, opts] = s.callsTo.runSynthesis.mock.calls[0];
      expect(parsed.creatorId).toBe("creator_abc");
      expect(parsed.posts).toHaveLength(2);
      expect(parsed.posts[0].kind).toBe("video");
      expect(parsed.posts[1].kind).toBe("text-context");
      expect(parsed.thinkingBudget).toBe("high");
      expect(opts.client).toBeDefined();
    } finally {
      await s.close();
    }
  });

  it("returns 502 with structured error when orchestrator returns ok:false", async () => {
    const failingImpl: typeof runSynthesis = async () => ({
      ok: false,
      error: {
        code: "gemini-failure",
        detail: "503 from upstream",
      },
      diagnostics: {
        videosRequested: 1,
        videosDownloaded: 1,
        videosUploaded: 1,
        skippedVideos: [],
        totalElapsedMs: 10,
        downloadElapsedMs: 1,
        uploadElapsedMs: 1,
        geminiElapsedMs: 1,
      },
    });
    const s = await bootServer({ runSynthesisImpl: failingImpl });
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(502);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "gemini-failure" },
      });
    } finally {
      await s.close();
    }
  });

  it("returns 500 on unexpected throw from orchestrator", async () => {
    const throwingImpl: typeof runSynthesis = async () => {
      throw new Error("kaboom");
    };
    const s = await bootServer({ runSynthesisImpl: throwingImpl });
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        ok: false,
        error: { code: "internal" },
      });
    } finally {
      await s.close();
    }
  });

  it("returns 200 with content + diagnostics on happy path", async () => {
    const s = await bootServer();
    try {
      const res = await postJson(s.port, "/synthesize", validBody(), {
        authorization: `Bearer ${SECRET}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        content: expect.any(String),
        model: "gemini-3-flash",
        usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 25 },
      });
    } finally {
      await s.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* runSynthesis cleanup contract — directly                                    */
/* -------------------------------------------------------------------------- */

describe("runSynthesis — cleanup discipline", () => {
  it("removes downloaded files on the success path", async () => {
    const cleanupCalls: string[] = [];
    vi.doMock("../src/video", async () => {
      const actual = await vi.importActual<typeof import("../src/video")>(
        "../src/video"
      );
      return {
        ...actual,
        cleanupVideo: (p: string) => cleanupCalls.push(p),
        cleanupTmpDirOlderThan: () => {},
        downloadVideo: async () => ({
          ok: true,
          filePath: "/tmp/fake_video.mp4",
          elapsedSec: 0.1,
        }),
      };
    });
    // re-import after mock
    const { runSynthesis: r } = await import("../src/synthesize");

    const result = await r(
      {
        creatorId: "c1",
        systemPrompt: "x".repeat(60),
        userPayloadJson: "{}",
        posts: [
          {
            postId: "p1",
            platform: "tiktok",
            videoUrl: "https://t/1",
            kind: "video",
          },
        ],
        thinkingBudget: "high",
      },
      {
        client: {} as never,
        uploadImpl: async (_c, fp, ctx) => ({
          postId: ctx.postId,
          platform: ctx.platform,
          fileUri: `files/${ctx.postId}`,
          mimeType: "video/mp4",
        }),
        generateImpl: async () => ({
          content: "{}",
          usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
          model: "gemini-3-flash",
        }),
      } as unknown as SynthesizeOptions
    );

    expect(result.ok).toBe(true);
    expect(cleanupCalls).toContain("/tmp/fake_video.mp4");
    vi.doUnmock("../src/video");
  });

  it("removes downloaded files on the failure path (gemini throws)", async () => {
    const cleanupCalls: string[] = [];
    vi.resetModules();
    vi.doMock("../src/video", async () => {
      const actual = await vi.importActual<typeof import("../src/video")>(
        "../src/video"
      );
      return {
        ...actual,
        cleanupVideo: (p: string) => cleanupCalls.push(p),
        cleanupTmpDirOlderThan: () => {},
        downloadVideo: async () => ({
          ok: true,
          filePath: "/tmp/fake_video2.mp4",
          elapsedSec: 0.1,
        }),
      };
    });
    const { runSynthesis: r } = await import("../src/synthesize");
    const { GeminiError } = await import("../src/gemini");

    const result = await r(
      {
        creatorId: "c2",
        systemPrompt: "x".repeat(60),
        userPayloadJson: "{}",
        posts: [
          {
            postId: "p2",
            platform: "tiktok",
            videoUrl: "https://t/2",
            kind: "video",
          },
        ],
        thinkingBudget: "high",
      },
      {
        client: {} as never,
        uploadImpl: async (_c, fp, ctx) => ({
          postId: ctx.postId,
          platform: ctx.platform,
          fileUri: `files/${ctx.postId}`,
          mimeType: "video/mp4",
        }),
        generateImpl: async () => {
          throw new GeminiError("boom", "generate-content");
        },
      } as unknown as SynthesizeOptions
    );

    expect(result.ok).toBe(false);
    expect(cleanupCalls).toContain("/tmp/fake_video2.mp4");
    vi.doUnmock("../src/video");
    vi.resetModules();
  });

  it("treats download failure as a skipped video (non-fatal) and still calls Gemini", async () => {
    let geminiCalled = false;
    const result = await runSynthesis(
      {
        creatorId: "c3",
        systemPrompt: "x".repeat(60),
        userPayloadJson: "{}",
        posts: [
          {
            postId: "p3a",
            platform: "tiktok",
            videoUrl: "https://t/3a",
            kind: "video",
          },
          {
            postId: "p3b",
            platform: "tiktok",
            videoUrl: "https://t/3b",
            kind: "video",
          },
        ],
        thinkingBudget: "high",
      },
      {
        client: {} as never,
        downloadImpl: async (_p, url) =>
          url.endsWith("3a")
            ? { ok: false, error: "yt-dlp-failed", elapsedSec: 0 }
            : { ok: true, filePath: "/tmp/p3b.mp4", elapsedSec: 0.5 },
        uploadImpl: async (_c, _fp, ctx) => ({
          postId: ctx.postId,
          platform: ctx.platform,
          fileUri: `files/${ctx.postId}`,
          mimeType: "video/mp4",
        }),
        generateImpl: async () => {
          geminiCalled = true;
          return {
            content: "{}",
            usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
            model: "gemini-3-flash",
          };
        },
      } as unknown as SynthesizeOptions
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.videosRequested).toBe(2);
    expect(result.diagnostics.videosDownloaded).toBe(1);
    expect(result.diagnostics.skippedVideos).toHaveLength(1);
    expect(result.diagnostics.skippedVideos[0].postId).toBe("p3a");
    expect(result.diagnostics.skippedVideos[0].stage).toBe("download");
    expect(geminiCalled).toBe(true);
  });

  it("text-context posts do NOT get downloaded (only video kind)", async () => {
    const downloadSpy = vi.fn().mockResolvedValue({
      ok: true,
      filePath: "/tmp/never.mp4",
      elapsedSec: 0,
    });
    await runSynthesis(
      {
        creatorId: "c4",
        systemPrompt: "x".repeat(60),
        userPayloadJson: "{}",
        posts: [
          {
            postId: "p4_txt",
            platform: "instagram",
            videoUrl: "https://i/4",
            kind: "text-context",
          },
        ],
        thinkingBudget: "high",
      },
      {
        client: {} as never,
        downloadImpl: downloadSpy,
        uploadImpl: async () => ({
          postId: "x",
          platform: "x",
          fileUri: "x",
          mimeType: "video/mp4",
        }),
        generateImpl: async () => ({
          content: "{}",
          usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
          model: "gemini-3-flash",
        }),
      } as unknown as SynthesizeOptions
    );
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});
