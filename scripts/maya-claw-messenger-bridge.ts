#!/usr/bin/env tsx
/**
 * Maya ↔ Claw Messenger bridge — standalone Node process.
 *
 * Bypasses OpenClaw entirely. Connects directly to Claw Messenger's
 * WebSocket relay (wss://claw-messenger.onrender.com/ws?key=<apiKey>),
 * receives inbound iMessage/SMS/RCS messages, calls Gemini 3 Flash via
 * OpenRouter to compose a reply (using the same SOUL_BLOCK + Riley
 * fixture as scripts/maya-telegram-creator-demo.ts), and sends the
 * reply back over the same WebSocket.
 *
 * This is the "minimum viable runtime" — proves the inbound→model→
 * outbound loop works end-to-end on iMessage TODAY without depending
 * on OpenClaw plugin discovery (which won't survive Fly machine
 * restarts because /usr/local/lib/node_modules is on the image, not
 * on the persistent /data volume).
 *
 * Wire protocol reverse-engineered from
 * node_modules/@emotion-machine/claw-messenger/dist/{channel,outbound/send,ws/client}.js:
 *
 *   Inbound:
 *     { type: "message", from: "+15555551234", text: "...", messageId,
 *       attachments?, isGroup?, chatId?, participants? }
 *
 *   Outbound (request/response):
 *     ws.send({ type: "send", to: "+15555551234",
 *               parts: [{ type: "text", value: "..." }],
 *               service: "iMessage", id: "corr-N-<ts>" })
 *     ← { id: "corr-N-<ts>", ok: true, messageId, chatId }
 *
 *   Server-initiated ping → reply { type: "pong" }
 *   Client-initiated ping every 30s → expect { type: "pong" }
 *
 * Usage (run from repo root):
 *   npx tsx scripts/maya-claw-messenger-bridge.ts
 *
 * Env (read from .env.local):
 *   - CLAW_MESSENGER_API_KEY   (or hardcoded fallback below for local demo)
 *   - OPENROUTER_API_KEY
 *   - MAYA_DEMO_MODEL          (defaults to google/gemini-3-flash-preview)
 *   - CLAW_MESSENGER_PREFERRED_SERVICE  (defaults to "iMessage")
 *
 * The bridge runs forever. Ctrl-C to stop.
 */

import WebSocket from "ws";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* -------------------------------------------------------------------------- */
/* Env loading                                                                 */
/* -------------------------------------------------------------------------- */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv(): void {
  const envPath = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const src = readFileSync(envPath, "utf8");
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadDotEnv();

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

const CLAW_API_KEY =
  process.env.CLAW_MESSENGER_API_KEY ??
  "cm_live_iJo0x5gw_3MkXd0AlS7DKoRn0LVQaNpPc0uHTjuw2Ts8XMKiyPgY";
const CLAW_SERVER_URL = "wss://claw-messenger.onrender.com/ws";
const PREFERRED_SERVICE =
  process.env.CLAW_MESSENGER_PREFERRED_SERVICE ?? "iMessage";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL =
  process.env.MAYA_DEMO_MODEL ??
  process.env.OPENROUTER_DEFAULT_MODEL ??
  "google/gemini-3-flash-preview";

if (!OPENROUTER_API_KEY) {
  console.error("FATAL: OPENROUTER_API_KEY not set in .env.local");
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Riley fixture + SOUL_BLOCK (same as telegram demo)                          */
/* -------------------------------------------------------------------------- */

const RILEY_PICTURE = {
  name: "Riley",
  primaryHandle: "@dadstrong_test",
  platform: "tiktok" as const,
  followers: 15_400,
  niche: "fitness for new dads",
  subNiches: [
    "postpartum dad recovery",
    "5-min home workouts",
    "dad-baby workout combos",
  ],
  voice:
    "warm, no-bullshit, slightly self-deprecating, occasional gym-bro slang sparingly",
  goals: {
    primary: "grow to 100K followers",
    secondary: "land first 4-figure brand deal",
    timeline: "9 months",
  },
  weeklyHours: 8,
  tonePreference: "strategic" as const,
  brandDealFloor: 1500,
  topHooks: [
    "POV: it's 4am, baby's asleep, and you have exactly 7 minutes — here's what I do",
    "Three exercises every new dad should do before the 6-week mark",
    "The dumbbell move that fixed my back after 6 months of carrying her",
  ],
  bottomHooks: [
    "My morning routine as a new dad",
    "How I balance fatherhood and fitness",
  ],
  recentPosts: [
    {
      id: "tt_2026_05_01_a",
      caption: "POV: 4am wake-up + 7 minutes — here's the routine",
      views: 47200,
      likes: 4_180,
      comments: 312,
      saves: 891,
      postedAt: "2026-05-01T04:18:00Z",
      hookPattern: "POV constraint hook",
    },
    {
      id: "tt_2026_04_30_a",
      caption: "Bench press but my daughter is the weight",
      views: 8_900,
      likes: 612,
      comments: 47,
      saves: 38,
      postedAt: "2026-04-30T18:00:00Z",
      hookPattern: "novelty visual",
    },
  ],
  competitorWatch: [
    {
      handle: "@dadbod_to_godbod",
      followers: 87_000,
      recentTopHook:
        "what your wife actually wants you to look like at 35",
    },
    {
      handle: "@5min.dad.fit",
      followers: 41_000,
      recentTopHook:
        "the only ab move new dads should do (your back will thank you)",
    },
  ],
  openCommitments: [
    {
      id: "cm_1",
      description: "Post 3 TikToks this week",
      status: "1 of 3 posted",
    },
    {
      id: "cm_2",
      description: "Reply to 5 DMs that mention training programs",
      status: "0 of 5 replied",
    },
  ],
};

const SOUL_BLOCK = `You are Maya — Riley's AI creator manager. You are NOT a generic AI assistant.

Voice: warm, direct, slightly dry. You text Riley like a smart friend who happens to know his data inside out. No exclamation point spam. No "let's crush it!" energy. No platitudes. No bullet salads — write like you'd text. Mobile-first, under 200 words unless explicitly asked for long-form.

Anti-sycophancy is non-negotiable: you never say "great question" or "amazing post". If a post underperforms you say so plainly, with the data, and then propose what's next. If you don't have data, you don't pretend.

Grounded or silent: every claim about Riley's account cites a specific number, post id, or named comparable. If you can't ground a claim, you don't make it. Better to send 3 grounded sentences than 5 with one made-up stat.

You're being texted directly on iMessage right now. Reply naturally — no preface, no "Hi! I'm Maya". Just answer or react like a manager would.

Riley's full picture (cite specifics naturally; don't dump the JSON):
${JSON.stringify(RILEY_PICTURE, null, 2)}`;

/* -------------------------------------------------------------------------- */
/* OpenRouter call                                                             */
/* -------------------------------------------------------------------------- */

async function callMaya(userMessage: string): Promise<string> {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://hey-maya.ai",
      "X-Title": "HeyMaya iMessage bridge",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SOUL_BLOCK },
        { role: "user", content: userMessage },
      ],
      reasoning: { effort: "low" },
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("OpenRouter returned empty content");
  return content;
}

/* -------------------------------------------------------------------------- */
/* Claw Messenger WebSocket bridge                                             */
/* -------------------------------------------------------------------------- */

interface ClawSendResponse {
  id: string;
  ok: boolean;
  messageId?: string;
  chatId?: string;
  error?: string;
}

interface ClawInboundMessage {
  type: "message";
  from: string;
  text?: string;
  messageId?: string;
  isGroup?: boolean;
  chatId?: string;
  attachments?: Array<unknown>;
}

let correlationCounter = 0;
function nextCorrelationId(): string {
  return `corr-${++correlationCounter}-${Date.now()}`;
}

const pending = new Map<
  string,
  { resolve: (v: ClawSendResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>();

function sendRequest(
  ws: WebSocket,
  message: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<ClawSendResponse> {
  const id = nextCorrelationId();
  message.id = id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify(message));
  });
}

async function handleInbound(
  ws: WebSocket,
  data: ClawInboundMessage
): Promise<void> {
  const from = data.from;
  const text = data.text ?? "";
  if (!text) {
    log(`[${from}] empty text (likely media-only) — ignoring`);
    return;
  }
  log(`[${from}] inbound: "${text}"`);

  const t0 = Date.now();
  let reply: string;
  try {
    reply = await callMaya(text);
  } catch (err) {
    log(`[${from}] model call failed: ${(err as Error).message}`);
    reply =
      "Hit a snag reaching the model just now. Try again in a sec — I'm here.";
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`[${from}] generated reply in ${elapsed}s, ${reply.length} chars`);

  try {
    const resp = await sendRequest(ws, {
      type: "send",
      to: from,
      parts: [{ type: "text", value: reply }],
      service: PREFERRED_SERVICE,
    });
    if (resp.ok) {
      log(`[${from}] sent (msgId=${resp.messageId})`);
    } else {
      log(`[${from}] send failed: ${resp.error ?? "unknown"}`);
    }
  } catch (err) {
    log(`[${from}] send threw: ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Connect + reconnect                                                         */
/* -------------------------------------------------------------------------- */

const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  // eslint-disable-next-line no-console
  console.log(`[${ts}] ${msg}`);
}

function connect(): void {
  const url = `${CLAW_SERVER_URL}?key=${encodeURIComponent(CLAW_API_KEY)}`;
  log(`Connecting to ${CLAW_SERVER_URL}...`);
  const ws = new WebSocket(url);

  let pingTimer: NodeJS.Timeout | null = null;

  ws.on("open", () => {
    log(`Connected. preferredService=${PREFERRED_SERVICE} model=${DEFAULT_MODEL}`);
    pingTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        /* ignore */
      }
    }, PING_INTERVAL_MS);
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      log(`Failed to parse message: ${(err as Error).message}`);
      return;
    }

    // Correlated response to our request
    const id = data.id as string | undefined;
    if (id && pending.has(id)) {
      const p = pending.get(id)!;
      pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(data as unknown as ClawSendResponse);
      return;
    }

    // Server-initiated ping
    if (data.type === "ping") {
      try {
        ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        /* ignore */
      }
      return;
    }

    // Pong
    if (data.type === "pong") return;

    // Inbound user message
    if (data.type === "message") {
      void handleInbound(ws, data as unknown as ClawInboundMessage);
      return;
    }

    // Reaction / typing / status — log but don't act
    if (
      data.type === "reaction" ||
      data.type === "typing" ||
      data.type === "status"
    ) {
      log(`[${String(data.type)}] ${JSON.stringify(data).slice(0, 150)}`);
      return;
    }

    log(`Unhandled message type: ${JSON.stringify(data).slice(0, 200)}`);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    log(`Disconnected (code=${code} reason=${reason?.toString() ?? ""})`);
    if (pingTimer) clearInterval(pingTimer);
    // Reject pending
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Connection closed"));
      pending.delete(id);
    }
    // Don't reconnect on auth errors / eviction
    if (code === 1008 || code === 4003) {
      log(`Fatal close — not reconnecting`);
      process.exit(1);
    }
    log(`Reconnecting in ${RECONNECT_DELAY_MS}ms...`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err: Error) => {
    log(`WebSocket error: ${err.message}`);
  });
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

log("Maya ↔ Claw Messenger bridge starting");
log(`Repo: ${REPO_ROOT}`);
log(`API key: ${CLAW_API_KEY.slice(0, 12)}...${CLAW_API_KEY.slice(-4)}`);
log(`Server: ${CLAW_SERVER_URL}`);
log(`Service: ${PREFERRED_SERVICE}`);
log(`Model: ${DEFAULT_MODEL}`);
log("Riley fixture loaded.");
log("");
log("Send a text to your Claw Messenger number from a registered phone.");
log("Press Ctrl-C to stop.");
log("");

connect();

// Keep the process alive
process.on("SIGINT", () => {
  log("SIGINT received, exiting");
  process.exit(0);
});
