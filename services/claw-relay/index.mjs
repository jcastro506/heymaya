/**
 * The Claw Messenger relay (plan §23). Claw delivers inbound events over a persistent
 * WebSocket, and Convex cannot hold one, so this process does: it connects, and for every
 * event POSTs the JSON, signed, to the product's `/imessage/webhook`. One relay for the whole
 * fleet. It keeps no state; a restart replays nothing (Claw's `sync` is asked for the last
 * five minutes on connect, and the webhook drops duplicates by vendor id).
 *
 * Env: CLAW_API_KEY, CLAW_WS_URL (default wss://claw-messenger.onrender.com/ws),
 *      CONVEX_WEBHOOK_URL (https://<deployment>.convex.site/imessage/webhook), CLAW_WEBHOOK_SECRET.
 */

import { createHmac } from "node:crypto";
import http from "node:http";

const KEY = process.env.CLAW_API_KEY ?? "";
const WS_URL = process.env.CLAW_WS_URL ?? "wss://claw-messenger.onrender.com/ws";
const TARGET = process.env.CONVEX_WEBHOOK_URL ?? "";
const SECRET = process.env.CLAW_WEBHOOK_SECRET ?? "";
const PORT = Number(process.env.PORT ?? 8080);

if (!KEY || !TARGET || !SECRET) {
  console.error("relay: CLAW_API_KEY, CONVEX_WEBHOOK_URL and CLAW_WEBHOOK_SECRET are all required");
  process.exit(1);
}

let connectedAt = null;
let forwarded = 0;
let failed = 0;
let lastEventAt = null;

function sign(raw) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function forward(event) {
  const raw = JSON.stringify(event);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(TARGET, { method: "POST", headers: { "Content-Type": "application/json", "x-maya-signature": sign(raw) }, body: raw });
      if (res.ok) { forwarded += 1; return; }
      console.error(`relay: webhook ${res.status} on attempt ${attempt}: ${(await res.text()).slice(0, 200)}`);
      if (res.status === 401 || res.status === 400) break; // ours to fix, not to retry
    } catch (error) {
      console.error(`relay: webhook failed on attempt ${attempt}: ${String(error)}`);
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  failed += 1;
}

function connect(backoffMs = 1000) {
  const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(KEY)}`);
  let ping = null;
  ws.addEventListener("open", () => {
    connectedAt = Date.now();
    console.log("relay: connected");
    // Anything that arrived while we were away, within the dedupe window.
    ws.send(JSON.stringify({ type: "sync", since: new Date(Date.now() - 5 * 60_000).toISOString() }));
    ping = setInterval(() => { try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* the close handler reconnects */ } }, 30_000);
  });
  ws.addEventListener("message", (m) => {
    let event;
    try { event = JSON.parse(String(m.data)); } catch { return; }
    if (!event || typeof event.type !== "string") return;
    if (event.type === "pong" || event.type === "sync.done") return;
    lastEventAt = Date.now();
    void forward(event);
  });
  ws.addEventListener("close", (e) => {
    if (ping) clearInterval(ping);
    connectedAt = null;
    const next = Math.min(backoffMs * 2, 30_000);
    console.error(`relay: closed (${e.code}); reconnecting in ${next}ms`);
    setTimeout(() => connect(next), next);
  });
  ws.addEventListener("error", (e) => console.error(`relay: socket error ${String(e?.message ?? e)}`));
}

// A health endpoint the product's smoke check can read: connected, counts, last event.
http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/healthz") {
    const body = JSON.stringify({ ok: connectedAt !== null, connectedForMs: connectedAt ? Date.now() - connectedAt : 0, forwarded, failed, lastEventAt });
    res.writeHead(connectedAt ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(body);
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`relay: health on :${PORT}`));

connect();
