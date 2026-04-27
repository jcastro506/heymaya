/**
 * Express server for the video-synth-worker.
 *
 * Routes:
 *   GET  /health      → 200 if env is configured + tmp dir is writable
 *   POST /synthesize  → Auth: bearer WORKER_SHARED_SECRET. Body: per Zod schema.
 *
 * Auth: HMAC-style shared bearer. We never trust the request body's creatorId
 * for cross-tenant isolation — that proof comes from the bearer match
 * (only our Convex deployment knows the secret). The Convex action that
 * calls us has already re-resolved the creator from Clerk identity before
 * sending us their data.
 *
 * Cross-cutting:
 *   • Structured JSON logs (one line per request) on stdout/stderr.
 *   • All long operations have explicit timeouts inside the orchestrator.
 *   • The `fail-closed` discipline: missing/wrong bearer → 401 fast,
 *     no body parsed.
 *   • Body size limit: 5MB. Every request's payload is the per-creator
 *     prompt text + the post list (URLs only) — no binary upload here.
 */

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { existsSync, accessSync, constants as fsConstants } from "node:fs";
import { buildGeminiClient } from "./gemini";
import { runSynthesis, type SynthesizeRequestBody } from "./synthesize";
import { TMP_DIR } from "./video";

const SynthesizePostSchema = z.object({
  postId: z.string().min(1).max(256),
  platform: z.string().min(1).max(64),
  videoUrl: z.string().url().max(2048),
  kind: z.enum(["video", "text-context"]),
});

const SynthesizeBodySchema = z.object({
  creatorId: z.string().min(1).max(256),
  systemPrompt: z.string().min(50).max(60_000),
  userPayloadJson: z.string().min(2).max(2_000_000),
  posts: z.array(SynthesizePostSchema).max(150),
  thinkingBudget: z.enum(["none", "low", "medium", "high"]),
  retryReminder: z.string().max(8_000).optional(),
});

export interface ServerOptions {
  /** Override the shared secret. Default reads from env. */
  sharedSecret?: string;
  /** Inject a Gemini client (tests). When absent, built from env. */
  geminiClient?: Parameters<typeof runSynthesis>[1]["client"];
  /** Inject the synthesize function (tests). */
  runSynthesisImpl?: typeof runSynthesis;
  /** Bind to a custom temp dir (tests). */
  tmpDir?: string;
  /** Override the model name (tests). */
  model?: string;
  /** Structured logger (tests). */
  log?: (line: Record<string, unknown>) => void;
}

export function buildApp(options: ServerOptions = {}): Express {
  const sharedSecret =
    options.sharedSecret ?? process.env.WORKER_SHARED_SECRET ?? "";
  const log = options.log ?? defaultLog;

  if (!sharedSecret && process.env.NODE_ENV === "production") {
    throw new Error(
      "WORKER_SHARED_SECRET is not set — refusing to start in production."
    );
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    const dirOk = (() => {
      try {
        if (!existsSync(TMP_DIR)) return true; // we'll create lazily
        accessSync(TMP_DIR, fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    })();
    const hasGenAiKey = Boolean(process.env.GOOGLE_GENAI_API_KEY);
    const hasSecret = Boolean(sharedSecret);
    const ready = dirOk && hasGenAiKey && hasSecret;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      tmpDirWritable: dirOk,
      hasGenAiKey,
      hasSecret,
    });
  });

  app.post(
    "/synthesize",
    requireBearer(sharedSecret),
    async (req: Request, res: Response) => {
      const reqStart = Date.now();
      let parsed: SynthesizeRequestBody;
      try {
        parsed = SynthesizeBodySchema.parse(req.body) as SynthesizeRequestBody;
      } catch (err) {
        const issues =
          err instanceof z.ZodError
            ? err.issues.slice(0, 10).map((i) => ({
                path: i.path.join("."),
                message: i.message,
              }))
            : [{ path: "(unknown)", message: String(err) }];
        log({
          msg: "synthesize:bad-request",
          issues,
          ip: req.ip,
        });
        res.status(400).json({
          ok: false,
          error: { code: "bad-request", issues },
        });
        return;
      }

      let geminiClient = options.geminiClient;
      if (!geminiClient) {
        try {
          geminiClient = buildGeminiClient();
        } catch (err) {
          log({
            msg: "synthesize:gemini-init-failed",
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(503).json({
            ok: false,
            error: {
              code: "gemini-init",
              detail: "Worker is missing GOOGLE_GENAI_API_KEY or SDK init failed.",
            },
          });
          return;
        }
      }

      const synth = options.runSynthesisImpl ?? runSynthesis;
      try {
        const result = await synth(parsed, {
          client: geminiClient,
          tmpDir: options.tmpDir,
          model: options.model,
          log,
        });

        log({
          msg: "synthesize:done",
          creatorId: parsed.creatorId,
          ok: result.ok,
          elapsedMs: Date.now() - reqStart,
        });

        if (result.ok) {
          res.status(200).json({
            ok: true,
            content: result.content,
            model: result.model,
            usage: result.usage,
            diagnostics: result.diagnostics,
          });
        } else {
          res.status(502).json({
            ok: false,
            error: result.error,
            diagnostics: result.diagnostics,
          });
        }
      } catch (err) {
        // Last-line defensive catch; runSynthesis is built to never throw,
        // but if a genuinely unexpected exception escapes, surface it as a
        // 500 with a structured message. Convex caller treats this as a
        // retryable failure.
        log({
          msg: "synthesize:unexpected-throw",
          creatorId: parsed.creatorId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        res.status(500).json({
          ok: false,
          error: {
            code: "internal",
            detail: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  );

  // 404 for everything else.
  app.use((req: Request, res: Response) => {
    res
      .status(404)
      .json({ ok: false, error: { code: "not-found", detail: req.path } });
  });

  // Final error guard so a thrown synchronous error in middleware doesn't
  // surface as Express's default HTML page.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log({
      msg: "express:error",
      error: err instanceof Error ? err.message : String(err),
    });
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      error: {
        code: "internal",
        detail: err instanceof Error ? err.message : String(err),
      },
    });
  });

  return app;
}

/**
 * Bearer-token middleware. Constant-time compares the bearer against the
 * shared secret. Rejects with 401 (no body) on mismatch, missing, or
 * malformed Authorization header.
 */
export function requireBearer(secret: string) {
  return function bearerGate(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!secret) {
      // Configuration error — fail-closed.
      res
        .status(503)
        .json({ ok: false, error: { code: "no-secret-configured" } });
      return;
    }
    const header = req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ ok: false, error: { code: "missing-bearer" } });
      return;
    }
    const provided = header.slice("Bearer ".length).trim();
    if (!provided) {
      res
        .status(401)
        .json({ ok: false, error: { code: "missing-bearer" } });
      return;
    }
    if (!constantTimeStringEqual(provided, secret)) {
      res
        .status(401)
        .json({ ok: false, error: { code: "invalid-bearer" } });
      return;
    }
    next();
  };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  // Pad to the same byte length so timingSafeEqual doesn't throw on length
  // mismatch — but record the original length-mismatch as failure. Otherwise
  // the timing of "rejection" reveals length, which leaks one bit of info
  // about the secret.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Compare against a same-length buffer to keep timing flat, then return
    // false unconditionally.
    const fakeBuf = Buffer.alloc(bBuf.length);
    timingSafeEqual(fakeBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function defaultLog(line: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ ts: Date.now(), ...line }) + "\n");
}

/**
 * Production entry point. Only runs when invoked as `node dist/server.js` —
 * test imports of `buildApp` skip the boot.
 */
if (require.main === module) {
  const port = Number(process.env.PORT ?? 8080);
  const app = buildApp();
  app.listen(port, () => {
    process.stdout.write(
      JSON.stringify({
        ts: Date.now(),
        msg: "worker:listening",
        port,
        tmpDir: TMP_DIR,
      }) + "\n"
    );
  });
}
