import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export interface WalkthroughDiagnosis {
  coreWorkflow: string;
  userProblem: string;
  strongestDemoMoments: string[];
  beforeAfterContrast: string;
  confusingMoments: string[];
  contentAssets: string[];
  facelessScreenRecordingEnough: boolean;
  founderFaceOrUgcMightHelp: boolean;
  shortFormFormatCandidates: string[];
  unsupportedClaimsOrMissingContext: string[];
}

const MAX_WALKTHROUGH_BYTES = 150 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);

export const generateWalkthroughUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("generateWalkthroughUploadUrl requires a signed-in user.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerWalkthroughUpload = mutation({
  args: {
    appId: v.id("gtmApps"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"gtmWalkthroughUploads">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("registerWalkthroughUpload requires a signed-in user.");
    }
    validateWalkthroughFile(args);
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") {
      throw new Error("GTM account not found.");
    }
    const app = await ctx.db.get(args.appId);
    if (!app || app.accountId !== creator._id) {
      throw new Error("walkthrough app does not belong to this account.");
    }
    const now = Date.now();
    return await ctx.db.insert("gtmWalkthroughUploads", {
      accountId: creator._id,
      appId: args.appId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      bytes: args.bytes,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getWalkthroughForAnalysis = internalQuery({
  args: { uploadId: v.id("gtmWalkthroughUploads"), clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    upload: Doc<"gtmWalkthroughUploads">;
    app: Doc<"gtmApps">;
  } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return null;
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.accountId !== creator._id) return null;
    const app = await ctx.db.get(upload.appId);
    if (!app || app.accountId !== creator._id) return null;
    return { upload, app };
  },
});

export const patchWalkthroughStatus = internalMutation({
  args: {
    uploadId: v.id("gtmWalkthroughUploads"),
    status: v.union(
      v.literal("queued"),
      v.literal("analyzing"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    diagnosis: v.optional(v.any()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) throw new Error("walkthrough upload not found.");
    const now = Date.now();
    await ctx.db.patch(args.uploadId, {
      status: args.status,
      diagnosis: args.diagnosis,
      failureReason: args.failureReason,
      updatedAt: now,
    });
    if (args.status === "succeeded" && args.diagnosis) {
      const app = await ctx.db.get(upload.appId);
      await ctx.db.patch(upload.appId, {
        diagnosis: {
          ...(isRecord(app?.diagnosis) ? app?.diagnosis : {}),
          walkthrough: args.diagnosis,
        },
        updatedAt: now,
      });
    }
  },
});

export const analyzeMyWalkthroughUpload = action({
  args: { uploadId: v.id("gtmWalkthroughUploads") },
  handler: async (ctx: ActionCtx, args): Promise<WalkthroughDiagnosis> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("analyzeMyWalkthroughUpload requires a signed-in user.");
    }
    const row = await ctx.runQuery(
      internal.gtmMaya.walkthrough.getWalkthroughForAnalysis,
      { uploadId: args.uploadId, clerkUserId: identity.subject }
    );
    if (!row) throw new Error("walkthrough upload not found for signed-in user.");

    await ctx.runMutation(internal.gtmMaya.walkthrough.patchWalkthroughStatus, {
      uploadId: args.uploadId,
      status: "analyzing",
    });

    try {
      const url = await ctx.storage.getUrl(row.upload.storageId);
      if (!url) throw new Error("storage returned no URL for walkthrough.");
      const diagnosis = await analyzeWalkthroughWithGemini({
        videoUrl: url,
        mimeType: row.upload.mimeType,
        app: row.app,
        fetchImpl: fetch,
      });
      await ctx.runMutation(
        internal.gtmMaya.walkthrough.patchWalkthroughStatus,
        {
          uploadId: args.uploadId,
          status: "succeeded",
          diagnosis,
        }
      );
      return diagnosis;
    } catch (err) {
      await ctx.runMutation(
        internal.gtmMaya.walkthrough.patchWalkthroughStatus,
        {
          uploadId: args.uploadId,
          status: "failed",
          failureReason: (err as Error).message,
        }
      );
      throw err;
    }
  },
});

export function validateWalkthroughFile(input: {
  mimeType: string;
  bytes: number;
}): void {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new Error("walkthrough must be an mp4, mov, m4v, or webm video.");
  }
  if (input.bytes <= 0) throw new Error("walkthrough file is empty.");
  if (input.bytes > MAX_WALKTHROUGH_BYTES) {
    throw new Error("walkthrough file is too large.");
  }
}

export async function analyzeWalkthroughWithGemini(input: {
  videoUrl: string;
  mimeType: string;
  app: Pick<
    Doc<"gtmApps">,
    | "name"
    | "url"
    | "founderWhy"
    | "stage"
    | "weekGoal"
    | "canRecordScreen"
    | "canShowFace"
    | "canRecordVoice"
    | "canProvideScreenshots"
    | "canPostTikTokManually"
    | "canPostInstagramManually"
  >;
  fetchImpl: typeof fetch;
}): Promise<WalkthroughDiagnosis> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is missing for walkthrough analysis.");
  }
  const video = await input.fetchImpl(input.videoUrl);
  if (!video.ok) {
    throw new Error(`walkthrough fetch failed: ${video.status}`);
  }
  const bytes = await video.arrayBuffer();
  validateWalkthroughFile({ mimeType: input.mimeType, bytes: bytes.byteLength });

  const model = process.env.MAYA_GTM_WALKTHROUGH_MODEL ?? "gemini-2.5-flash";
  const res = await input.fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: input.mimeType,
                  data: arrayBufferToBase64(bytes),
                },
              },
              { text: walkthroughPrompt(input.app) },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini walkthrough analysis failed: ${res.status}`);
  }
  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned no walkthrough diagnosis.");
  return parseWalkthroughDiagnosis(text);
}

export function parseWalkthroughDiagnosis(raw: string): WalkthroughDiagnosis {
  const parsed = JSON.parse(stripJsonFence(raw)) as Partial<WalkthroughDiagnosis>;
  const diagnosis: WalkthroughDiagnosis = {
    coreWorkflow: requiredString(parsed.coreWorkflow, "coreWorkflow"),
    userProblem: requiredString(parsed.userProblem, "userProblem"),
    strongestDemoMoments: requiredStringArray(
      parsed.strongestDemoMoments,
      "strongestDemoMoments"
    ),
    beforeAfterContrast: requiredString(
      parsed.beforeAfterContrast,
      "beforeAfterContrast"
    ),
    confusingMoments: stringArray(parsed.confusingMoments),
    contentAssets: stringArray(parsed.contentAssets),
    facelessScreenRecordingEnough: Boolean(parsed.facelessScreenRecordingEnough),
    founderFaceOrUgcMightHelp: Boolean(parsed.founderFaceOrUgcMightHelp),
    shortFormFormatCandidates: requiredStringArray(
      parsed.shortFormFormatCandidates,
      "shortFormFormatCandidates"
    ),
    unsupportedClaimsOrMissingContext: stringArray(
      parsed.unsupportedClaimsOrMissingContext
    ),
  };
  return diagnosis;
}

function walkthroughPrompt(
  app: Parameters<typeof analyzeWalkthroughWithGemini>[0]["app"]
): string {
  return `You are Maya GTM analyzing a founder's mobile app walkthrough.

Return JSON only with these exact keys:
coreWorkflow, userProblem, strongestDemoMoments, beforeAfterContrast,
confusingMoments, contentAssets, facelessScreenRecordingEnough,
founderFaceOrUgcMightHelp, shortFormFormatCandidates,
unsupportedClaimsOrMissingContext.

Context:
- App name: ${app.name ?? "unknown"}
- App URL/listing: ${app.url}
- Founder why: ${app.founderWhy ?? "not provided"}
- Stage: ${app.stage}
- Week goal: ${app.weekGoal}
- Can record screen: ${app.canRecordScreen}
- Can show face: ${app.canShowFace}
- Can record voice: ${app.canRecordVoice ?? false}
- Can provide screenshots: ${app.canProvideScreenshots ?? false}
- Can manually post TikTok: ${app.canPostTikTokManually ?? false}
- Can manually post Instagram: ${app.canPostInstagramManually ?? false}

Analyze only what is visible or clearly implied by the video. Do not infer an ICP the user did not give unless the app itself makes it obvious. Identify demo moments Maya can use for TikTok/Instagram scripts, slideshow/carousel posts, and calendar briefs.`;
}

function stripJsonFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Gemini diagnosis missing ${key}.`);
  }
  return value.trim();
}

function requiredStringArray(value: unknown, key: string): string[] {
  const array = stringArray(value);
  if (array.length === 0) throw new Error(`Gemini diagnosis missing ${key}.`);
  return array;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
