/**
 * Thin wrapper around the OpenClaw CLI for channel pairing + memory ops.
 *
 * Sprint 6C — channels.ts shells out to this helper to issue pair-requests,
 * confirm them, and unpair. Sprint 9 cleanup pass — profile.resetMayaMemory
 * extends the surface with memory rollback. Wave 5 (2026-04-26) verified the
 * surface against OpenClaw 2026.4.23 docs and added the `--delete` flag to
 * unpair (now required per the 4.20+ CLI). We deliberately do NOT
 * reimplement OpenClaw's channel routing or message handling
 * (project_openclaw_alignment.md): the CLI is the contract. If a future
 * OpenClaw release ships an HTTP control surface on the Fly machine, swap
 * the implementation here without changing the callers.
 *
 * Per `https://docs.openclaw.ai/cli/channels` (verified against 2026.4.23 in
 * Wave 5) + `/channels/pairing.md`, the channel surface looks like:
 *   openclaw channels add    --agent <appId> --channel <imessage|whatsapp|sms>
 *                            --identifier <phoneNumber>
 *     → returns { pairingId, qrCodeDataUrl?, smsConfirmationCode?, expiresAt }
 *   openclaw pairing approve <channel> <code> --pairing-id <pairingId>
 *     → returns { externalIdentifier }
 *   openclaw channels remove --agent <appId> --channel <channel>
 *                            --identifier <phoneNumber> --delete
 *     → returns void
 *
 *   The `--delete` flag is REQUIRED in 4.20+. Without it the command no-ops
 *   with a "would-delete" preview. The flag is appended in `channels.ts`
 *   when invoking `command: "unpair"`.
 *
 * Per `https://docs.openclaw.ai/cli/memory.md`, OpenClaw does not ship a
 * dedicated `memory reset` subcommand. The closest user-facing primitive is
 * `memory rem-backfill --rollback[-short-term]` which:
 *   - `--rollback`             removes previously written grounded diary
 *                              entries (long-term memory).
 *   - `--rollback-short-term`  removes previously staged grounded short-term
 *                              candidates.
 * resetMayaMemory issues both, scoped via `--agent <appId>`, to clear the
 * memory state Maya has accumulated since deploy. A full workspace wipe
 * requires `agents delete` + redeploy, which is out of scope for the
 * user-facing Profile reset (we keep handles, deals, and connections).
 *
 * Security:
 *   - We use `child_process.execFile` with an explicit args array. NEVER
 *     interpolate user input into a shell string — that's a command-injection
 *     vector (Maya creators control phoneNumber).
 *   - The CLI binary is selected from `OPENCLAW_CLI_BIN` env (default
 *     "openclaw"). It is not user-controllable.
 *   - stdout is parsed as a single JSON line; anything else is treated as a
 *     stderr-style failure with `ok=false`.
 *
 * Test seam:
 *   - `_setOpenclawCliForTests(fn)` swaps the executor with a fake. Tests use
 *     this to mock CLI responses without spawning a real subprocess. Reset
 *     to `null` between tests.
 */

export type OpenclawCommand =
  | "pair"
  | "confirm"
  | "unpair"
  | "memoryRollback"
  | "memoryRollbackShortTerm";

export interface OpenclawCliResult<T = unknown> {
  ok: boolean;
  data?: T;
  stderr?: string;
}

export interface OpenclawCliRequest {
  command: OpenclawCommand;
  args: ReadonlyArray<string>;
  /** Override the CLI timeout for slow networks. Default 15s. */
  timeoutMs?: number;
}

export type OpenclawCliExecutor = (
  req: OpenclawCliRequest
) => Promise<OpenclawCliResult>;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The native command surface we map onto. Each entry maps our internal
 * `command` enum onto the actual CLI subcommand path. Centralized so a
 * future OpenClaw rename only requires changing this table.
 */
const COMMAND_PATH: Record<OpenclawCommand, ReadonlyArray<string>> = {
  pair: ["channels", "add"],
  confirm: ["pairing", "approve"],
  unpair: ["channels", "remove"],
  // Memory rollback — see file header for rationale on using rem-backfill
  // with --rollback / --rollback-short-term as the closest user-facing
  // reset primitive OpenClaw exposes.
  memoryRollback: ["memory", "rem-backfill"],
  memoryRollbackShortTerm: ["memory", "rem-backfill"],
};

let __injectedExecutor: OpenclawCliExecutor | null = null;

/**
 * Test seam — swap the CLI executor. `null` resets to the production
 * subprocess implementation. ALWAYS call `_setOpenclawCliForTests(null)` in
 * an `afterEach` so injected mocks don't leak across tests.
 */
export function _setOpenclawCliForTests(
  executor: OpenclawCliExecutor | null
): void {
  __injectedExecutor = executor;
}

/**
 * Public entry point. Channels.ts calls this; nothing else should.
 *
 * Returns a tagged union so callers can distinguish OpenClaw errors (CLI
 * exited non-zero, or returned a malformed payload) from infra errors
 * (missing binary, timeout). Both come back as `{ ok: false }` — the
 * `stderr` carries the human-readable cause.
 */
export async function runOpenclawChannelCommand<T = unknown>(
  req: OpenclawCliRequest
): Promise<OpenclawCliResult<T>> {
  if (__injectedExecutor) {
    return (await __injectedExecutor(req)) as OpenclawCliResult<T>;
  }
  return await defaultExecutor<T>(req);
}

/* -------------------------------------------------------------------------- */
/* Production subprocess implementation                                        */
/* -------------------------------------------------------------------------- */

async function defaultExecutor<T>(
  req: OpenclawCliRequest
): Promise<OpenclawCliResult<T>> {
  // Convex actions run on the V8 isolate (edge-runtime). `child_process` is
  // NOT available there. The deploy pipeline that uses this client runs
  // inside an internalAction that is allowed to call Node APIs because Convex
  // routes node-side actions through a separate runtime; if the V8 isolate
  // tries to require node:child_process, the require throws at first call
  // and we surface a structured error rather than crashing the action.
  let execFile: typeof import("node:child_process").execFile;
  try {
    // dynamic import keeps edge-runtime tests from blowing up on file load.
    const cp = await import("node:child_process");
    execFile = cp.execFile;
  } catch (err) {
    return {
      ok: false,
      stderr: `node:child_process unavailable in this runtime — ${
        (err as Error).message
      }`,
    };
  }

  const bin = process.env.OPENCLAW_CLI_BIN ?? "openclaw";
  const subPath = COMMAND_PATH[req.command];
  const allArgs = [...subPath, ...req.args];
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<OpenclawCliResult<T>>((resolve) => {
    const child = execFile(
      bin,
      allArgs,
      {
        timeout: timeoutMs,
        // 1MB output buffer is overkill for a single JSON line but cheap.
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        // Disable shell interpretation entirely — we pass argv directly.
        shell: false,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            stderr: stderr?.toString() || err.message,
          });
          return;
        }
        const text = stdout?.toString().trim() ?? "";
        if (!text) {
          // No-op commands (e.g. unpair) are successful with empty stdout.
          resolve({ ok: true, data: undefined as T });
          return;
        }
        try {
          const parsed = JSON.parse(text) as T;
          resolve({ ok: true, data: parsed });
        } catch (parseErr) {
          resolve({
            ok: false,
            stderr: `openclaw stdout is not JSON: ${text.slice(0, 200)} (${
              (parseErr as Error).message
            })`,
          });
        }
      }
    );
    // Defense in depth: if the subprocess never invokes the callback (e.g.
    // a `kill -9` from outside), the explicit timeout above bounds the wait
    // and emits an error through execFile's own timeout handling.
    child.on("error", (err) => {
      // execFile's callback handles most errors; this fires on spawn failures
      // (binary not found, EACCES). Still resolve through the callback path
      // when possible — only resolve here if we somehow miss it.
      if (!child.connected && !child.killed) {
        // Best-effort fallback. The callback above will normally win.
        resolve({ ok: false, stderr: err.message });
      }
    });
  });
}
