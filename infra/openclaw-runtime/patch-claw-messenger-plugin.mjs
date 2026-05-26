import { readFileSync, writeFileSync } from "node:fs";

const channelPath = "/opt/openclaw-seed/extensions/claw-messenger/dist/channel.js";
const sendPath = "/opt/openclaw-seed/extensions/claw-messenger/dist/outbound/send.js";
const gatewayServerPath = "/usr/local/lib/node_modules/openclaw/dist/server.impl-DhtU4okW.js";
// Sprint B.3 — runtime-layer firewall (defense-in-depth). The existing
// claw-messenger send.js firewall (added Sprint 12.7.3) catches every
// outbound that flows through `sendMessage` / `sendGroupMessage`. After
// auditing openclaw 2026.4.23, every assistant-text delivery path
// (inbound-reply via `dispatchReplyWithBufferedBlockDispatcher`, proactive
// via `deliverAgentCommandResult`, route-reply via `routeReplyToOriginating`)
// eventually calls claw-messenger's `outbound.sendText` → `sendMessage`,
// so the existing firewall is sufficient on paper. This second layer
// patches openclaw's own `deliver-BAZ1LU-l.js::sendTextChunks` so the
// firewall trigger lives ABOVE plugin code — catches the assistant text
// before any channel-specific code runs and before per-chunk splitting.
// Channel-agnostic: covers Telegram/WhatsApp/Discord if/when added.
const deliverRuntimePath = "/usr/local/lib/node_modules/openclaw/dist/deliver-BAZ1LU-l.js";
let src = readFileSync(channelPath, "utf8");
let sendSrc = readFileSync(sendPath, "utf8");
let gatewaySrc = readFileSync(gatewayServerPath, "utf8");
let deliverSrc = readFileSync(deliverRuntimePath, "utf8");

// Sprint 13.1 — inbound media reliability.
// - Raise inbound media max bytes from 10MB → 100MB so iPhone video clips
//   don't get silently dropped.
// - If attachments exist but downloads fail (expired URL / too-large),
//   still dispatch an inbound envelope so Maya can respond ("I got a video
//   but couldn't load it") instead of staying silent.
//
// NOTE: This is a string patch because this file runs at image build time
// and the upstream plugin ships as JS, not TS.
if (src.includes('saveMediaBuffer(saved.buffer, saved.contentType ?? attachment.mimeType, "inbound", 10 * 1024 * 1024)')) {
  src = src.replaceAll(
    'saveMediaBuffer(saved.buffer, saved.contentType ?? attachment.mimeType, "inbound", 10 * 1024 * 1024)',
    'saveMediaBuffer(saved.buffer, saved.contentType ?? attachment.mimeType, "inbound", 100 * 1024 * 1024)'
  );
}

if (src.includes('const rawBody = text || (allMedia.length > 0 ? "<media:image>" : "");')) {
  src = src.replaceAll(
    'const rawBody = text || (allMedia.length > 0 ? "<media:image>" : "");',
    'const rawBody = text || (attachments.length > 0 ? "<media:attachment>" : "");'
  );
}

if (src.includes("buildChannelConfigSchema, DEFAULT_ACCOUNT_ID,")) {
  src = src.replace(
    "import { buildChannelConfigSchema, DEFAULT_ACCOUNT_ID, formatPairingApproveHint, PAIRING_APPROVED_MESSAGE, } from \"openclaw/plugin-sdk\";",
    "import { buildChannelConfigSchema, formatPairingApproveHint, PAIRING_APPROVED_MESSAGE, } from \"openclaw/plugin-sdk\";\nconst DEFAULT_ACCOUNT_ID = \"default\";"
  );
}

if (sendSrc.includes('import { normalizeE164 } from "openclaw/plugin-sdk";')) {
  sendSrc = sendSrc.replace(
    'import { normalizeE164 } from "openclaw/plugin-sdk";',
    `function normalizeE164(input) {
    const raw = String(input ?? "").trim();
    if (!raw) return null;
    const plusPrefixed = raw.startsWith("+");
    const digits = raw.replace(/\\D/g, "");
    if (!digits) return null;
    const normalized = plusPrefixed ? \`+\${digits}\` : (digits.length === 10 ? \`+1\${digits}\` : \`+\${digits}\`);
    return /^\\+[1-9]\\d{9,14}$/.test(normalized) ? normalized : null;
}`
  );
}

// Sprint 12.7.3 — pre-send firewall. Maya's underlying LLM ignores AGENTS.md
// procedural rules about trend grounding and iMessage markdown bans. We
// enforce at the wire: every outbound message routes through Convex
// validate_outbound_send before delivery. ok=false throws a structured
// `send-blocked: ...` Error so the LLM loop sees the failure and redrafts.
if (!sendSrc.includes("async function validateOutboundOrThrow(")) {
  const firewallHelper = `async function validateOutboundOrThrow(parts) {
    const creatorId = process.env.MAYA_CREATOR_ID;
    const httpBase = process.env.MAYA_CONVEX_HTTP_BASE;
    const secret = process.env.WEBHOOK_INTERNAL_SECRET;
    if (!creatorId || !httpBase || !secret) {
        return;
    }
    const text = (Array.isArray(parts) ? parts : [])
        .filter((p) => p && p.type === "text" && typeof p.value === "string")
        .map((p) => p.value)
        .join("\\n");
    if (!text) return;
    let res;
    try {
        res = await fetch(\`\${httpBase}/lc_maya/validate_outbound_send\`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ secret, creatorId, message: text }),
        });
    } catch (err) {
        console.warn("[firewall] validate_outbound_send network failure, allowing send:", String(err));
        return;
    }
    if (!res.ok) {
        console.warn(\`[firewall] validate_outbound_send returned HTTP \${res.status}, allowing send\`);
        return;
    }
    let body;
    try { body = await res.json(); } catch { return; }
    if (body && body.ok === false) {
        const reasons = Array.isArray(body.blockedReasons) ? body.blockedReasons.join("; ") : "blocked";
        const fix = body.suggestedFix ? \` Fix: \${body.suggestedFix}\` : "";
        throw new Error(\`send-blocked: \${reasons}.\${fix}\`);
    }
}
`;
  // Inject helper at the top of the file (after the existing imports/helpers,
  // before the first exported send fn). The exact upstream `ws.request({...})`
  // call is multi-line; replace just inside sendMessage rather than reproduce
  // the full body in the needle so minor upstream formatting drift doesn't
  // break the build.
  const sendMessageHeader = `export async function sendMessage(ws, to, parts, service) {
    const normalizedTarget = normalizeDirectTarget(to);
    if (!normalizedTarget) {
        throw new Error("Recipient is required");
    }
    const resp = await ws.request({`;
  if (!sendSrc.includes(sendMessageHeader)) {
    throw new Error("Unable to patch sendMessage pre-send hook; expected marker not found.");
  }
  sendSrc = sendSrc.replace(
    sendMessageHeader,
    `${firewallHelper}export async function sendMessage(ws, to, parts, service) {
    const normalizedTarget = normalizeDirectTarget(to);
    if (!normalizedTarget) {
        throw new Error("Recipient is required");
    }
    await validateOutboundOrThrow(parts);
    const resp = await ws.request({`
  );

  const sendGroupMessageHeader = `async function sendGroupMessage(ws, chatId, parts, service) {
    const resp = await ws.request({`;
  if (!sendSrc.includes(sendGroupMessageHeader)) {
    throw new Error("Unable to patch sendGroupMessage pre-send hook; expected marker not found.");
  }
  sendSrc = sendSrc.replace(
    sendGroupMessageHeader,
    `async function sendGroupMessage(ws, chatId, parts, service) {
    await validateOutboundOrThrow(parts);
    const resp = await ws.request({`
  );

  // sendToNewGroup has an inline ws.request — patch best-effort if the
  // canonical shape is present. Group-creation paths are rare in v0; if the
  // marker shifts we don't fail the build.
  const sendToNewGroupNeedle = `export async function sendToNewGroup(ws, to, text, service) {`;
  if (sendSrc.includes(sendToNewGroupNeedle)) {
    const inlineNeedle = /(export async function sendToNewGroup\(ws, to, text, service\) \{[\s\S]*?)(const resp = await ws\.request\(\{)/;
    const m = sendSrc.match(inlineNeedle);
    if (m && !m[1].includes("validateOutboundOrThrow")) {
      sendSrc = sendSrc.replace(
        inlineNeedle,
        `$1await validateOutboundOrThrow(parts);\n        $2`
      );
    }
  }
}

if (!src.includes("describeMessageTool:")) {
  const needle = '    actions: {\n        listActions: () => ["send", "react"],';
  const replacement = `    actions: {
        describeMessageTool: ({ cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            if (!account.enabled || !account.apiKey?.trim()) {
                return { actions: [], capabilities: [] };
            }
            return { actions: ["send", "react"], capabilities: [] };
        },
        listActions: () => ["send", "react"],`;

  if (src.includes(needle)) {
    src = src.replace(needle, replacement);
  } else {
    // Sprint 2.16u-fix10 — tolerate claw-messenger version drift. Older
    // versions of this plugin had a slightly different actions interface
    // shape. If the marker isn't found, the upstream plugin has likely
    // restructured this surface — log a warning and continue rather than
    // breaking the entire image build for a non-critical normalization patch.
    console.warn("[patch] skipped: Claw Messenger actions interface marker not found (plugin version drift); continuing.");
  }
}

if (!src.includes("function normalizeStartedAccount(")) {
  const needle = `function resolveAccount(cfg, _accountId) {
    const cloudConfig = (cfg.channels?.["claw-messenger"] ?? {});
    return {
        accountId: DEFAULT_ACCOUNT_ID,
        enabled: cloudConfig.enabled !== false,
        apiKey: cloudConfig.apiKey ?? "",
        serverUrl: cloudConfig.serverUrl ?? "wss://claw-messenger.onrender.com",
        preferredService: cloudConfig.preferredService ?? "iMessage",
        config: cloudConfig,
    };
}
`;
  const replacement = `${needle}function normalizeStartedAccount(ctx) {
    const cfg = ctx.cfg ?? getRuntime().config.loadConfig();
    const resolved = resolveAccount(cfg, ctx.account?.accountId);
    const incoming = ctx.account ?? {};
    return {
        ...resolved,
        ...incoming,
        accountId: incoming.accountId ?? resolved.accountId ?? DEFAULT_ACCOUNT_ID,
        enabled: incoming.enabled ?? resolved.enabled,
        apiKey: incoming.apiKey ?? resolved.apiKey,
        serverUrl: incoming.serverUrl ?? resolved.serverUrl,
        preferredService: incoming.preferredService ?? resolved.preferredService,
        config: incoming.config ?? resolved.config,
    };
}
`;

  if (src.includes(needle)) {
    src = src.replace(needle, replacement);
  } else {
    // Sprint 2.16u-fix10 — same drift-tolerance pattern as actions
    // interface patch above. If the resolveAccount needle has shifted in
    // a newer claw-messenger version, the normalizeStartedAccount helper
    // won't get inserted. The downstream call sites at lines 220+ are
    // already guarded by `if (src.includes(...))` so they no-op safely.
    console.warn("[patch] skipped: Claw Messenger account normalization marker not found (plugin version drift); continuing.");
  }
}

if (src.includes("            const account = ctx.account;")) {
  src = src.replace("            const account = ctx.account;", "            const account = normalizeStartedAccount(ctx);");
}

if (src.includes("            const resolvedAccountId = account.accountId;")) {
  src = src.replace(
    "            const resolvedAccountId = account.accountId;",
    `            const resolvedAccountId = account.accountId ?? DEFAULT_ACCOUNT_ID;
            account.accountId = resolvedAccountId;`
  );
}

if (src.includes("            const stopHandler = () => {\n                ctx.log?.info(`[${resolvedAccountId}] Stopping Claw Messenger provider`);")) {
  src = src.replace(
    `            const stopHandler = () => {
                ctx.log?.info(\`[\${resolvedAccountId}] Stopping Claw Messenger provider\`);
                ws.stop();
                wsClients.delete(resolvedAccountId);
            };
            ctx.abortSignal?.addEventListener("abort", stopHandler);
            return {
                stop: () => {
                    stopHandler();
                    ctx.abortSignal?.removeEventListener("abort", stopHandler);
                },
            };`,
    `            let stopped = false;
            const stopHandler = () => {
                if (stopped)
                    return;
                stopped = true;
                ctx.log?.info(\`[\${resolvedAccountId}] Stopping Claw Messenger provider\`);
                ws.stop();
                wsClients.delete(resolvedAccountId);
            };
            if (ctx.abortSignal?.aborted) {
                stopHandler();
                return;
            }
            await new Promise((resolve) => {
                ctx.abortSignal?.addEventListener("abort", resolve, { once: true });
            });
            stopHandler();`
  );
} else if (!src.includes("let stopped = false;")) {
  throw new Error("Unable to patch Claw Messenger channel lifetime; expected marker not found.");
}

if (src.includes("            running: runtime?.running ?? false,")) {
  src = src.replace(
    "            running: runtime?.running ?? false,",
    "            running: Boolean(wsClients.get(account.accountId)?.connected) || (runtime?.running ?? false),"
  );
}

if (src.includes("            running: snapshot.running ?? false,")) {
  src = src.replace(
    "            running: snapshot.running ?? false,",
    "            running: snapshot.running ?? Boolean(wsClients.get(snapshot.accountId ?? DEFAULT_ACCOUNT_ID)?.connected) ?? false,"
  );
}

writeFileSync(channelPath, src);
writeFileSync(sendPath, sendSrc);

const prewarmNeedle = `\t\t\tawait prewarmConfiguredPrimaryModel({
\t\t\t\tcfg: params.cfg,
\t\t\t\tlog: params.log
\t\t\t});
\t\t\tawait params.startChannels();`;

if (gatewaySrc.includes(prewarmNeedle)) {
  gatewaySrc = gatewaySrc.replace(
    prewarmNeedle,
    `\t\t\tparams.log.info("skipping primary model prewarm before channel startup");
\t\t\tawait params.startChannels();`
  );
}

const sidecarsAfterChannelsNeedle = `\tif (internalHooksConfigured || await hasGatewayStartupInternalHookListeners()) setTimeout(() => {
\t\timport("./internal-hooks-UC389sgW.js").then(({ createInternalHookEvent, triggerInternalHook }) => {
\t\t\ttriggerInternalHook(createInternalHookEvent("gateway", "startup", "gateway:startup", {
\t\t\t\tcfg: params.cfg,
\t\t\t\tdeps: params.deps,
\t\t\t\tworkspaceDir: params.defaultWorkspaceDir
\t\t\t}));
\t\t}).catch((err) => {
\t\t\tparams.log.warn(\`gateway startup internal hook failed: \${String(err)}\`);
\t\t});
\t}, 250);`;

const actualSidecarsAfterChannelsNeedle = `\tif (internalHooksConfigured || await hasGatewayStartupInternalHookListeners()) setTimeout(() => {
\t\timport("./internal-hooks-UC389sgW.js").then(({ createInternalHookEvent, triggerInternalHook }) => {
\t\t\ttriggerInternalHook(createInternalHookEvent("gateway", "startup", "gateway:startup", {
\t\t\t\tcfg: params.cfg,
\t\t\t\tdeps: params.deps,
\t\t\t\tworkspaceDir: params.defaultWorkspaceDir
\t\t\t}));
\t\t}, 250);
\tlet pluginServices = null;`;

if (gatewaySrc.includes(actualSidecarsAfterChannelsNeedle)) {
  gatewaySrc = gatewaySrc.replace(
    actualSidecarsAfterChannelsNeedle,
    `\tparams.log.info("skipping optional post-channel sidecars for creator runtime");
\treturn { pluginServices: null };
\tlet pluginServices = null;`
  );
} else if (!gatewaySrc.includes("skipping optional post-channel sidecars for creator runtime")) {
  const fallbackNeedle = `\tlet pluginServices = null;
\tawait measureStartup(params.startupTrace, "sidecars.plugin-services", async () => {`;
  if (!gatewaySrc.includes(fallbackNeedle)) {
    throw new Error("Unable to patch optional post-channel sidecars; expected marker not found.");
  }
  gatewaySrc = gatewaySrc.replace(
    fallbackNeedle,
    `\tparams.log.info("skipping optional post-channel sidecars for creator runtime");
\treturn { pluginServices: null };
\tlet pluginServices = null;
\tawait measureStartup(params.startupTrace, "sidecars.plugin-services", async () => {`
  );
}

const updateCheckNeedle = `\tconst stopGatewayUpdateCheckPromise = params.minimalTestGateway ? Promise.resolve(() => {}) : measureStartup(params.startupTrace, "post-attach.update-check", () => runtimeDeps.scheduleGatewayUpdateCheck({
\t\tcfg: params.cfgAtStart,
\t\tlog: params.log,
\t\tisNixMode: params.isNixMode,
\t\tonUpdateAvailableChange: (updateAvailable) => {
\t\t\tconst payload = { updateAvailable };
\t\t\tparams.broadcast(GATEWAY_EVENT_UPDATE_AVAILABLE, payload, { dropIfSlow: true });
\t\t}
\t}));`;

if (gatewaySrc.includes(updateCheckNeedle)) {
  gatewaySrc = gatewaySrc.replace(
    updateCheckNeedle,
    `\tconst stopGatewayUpdateCheckPromise = Promise.resolve(() => {});
\tparams.log.info("skipping OpenClaw startup update check for pinned creator runtime");`
  );
} else if (!gatewaySrc.includes("skipping OpenClaw startup update check for pinned creator runtime")) {
  throw new Error("Unable to patch startup update check; expected marker not found.");
}

// Sprint 2.16u-fix10 — REMOVED the gateway_start hooks skip patch.
//
// Earlier sprints stripped gateway_start in the name of a "lighter creator
// runtime". The consequence: OpenClaw's bundled `boot-md` hook (which fires
// BOOT.md on `gateway:startup`) never ran. Result: Maya had no instant-
// on-boot message — operators had to wait `heartbeat.every` (5m) for the
// first message instead of getting one ~60 sec after deploy like the
// original creator app did.
//
// With this patch block removed, OpenClaw runs gateway_start hooks
// normally. Combined with `hooks.internal.enabled: true` in the gateway
// config, the bundled `boot-md` hook fires BOOT.md on gateway-ready —
// restoring the prior creator app's instant-hello behavior.

const hooksFirstNeedle = `\t\t\tconst requestStages = [{
\t\t\t\tname: "hooks",
\t\t\t\trun: () => handleHooksRequest(req, res)
\t\t\t}];`;

if (gatewaySrc.includes(hooksFirstNeedle)) {
  gatewaySrc = gatewaySrc.replace(
    hooksFirstNeedle,
    `\t\t\tconst requestStages = [{
\t\t\t\tname: "gateway-probes",
\t\t\t\trun: () => handleGatewayProbeRequest(req, res, requestPath, resolvedAuth, trustedProxies, allowRealIpFallback, getReadiness)
\t\t\t}, {
\t\t\t\tname: "hooks",
\t\t\t\trun: () => handleHooksRequest(req, res)
\t\t\t}];`
  );
} else if (!gatewaySrc.includes(`name: "gateway-probes",
\t\t\t\trun: () => handleGatewayProbeRequest(req, res, requestPath, resolvedAuth, trustedProxies, allowRealIpFallback, getReadiness)
\t\t\t}, {
\t\t\t\tname: "hooks"`)) {
  throw new Error("Unable to move gateway probes before hooks; expected marker not found.");
}

const lateProbeWithPrefix = `\t\t\trequestStages.push({
\t\t\t\tname: "chat-managed-image-media",
\t\t\t\trun: async () => (await getManagedImageAttachmentsModule()).handleManagedOutgoingImageHttpRequest(req, res, {
\t\t\t\t\tauth: resolvedAuth,
\t\t\t\t\ttrustedProxies,
\t\t\t\t\tallowRealIpFallback,
\t\t\t\t\trateLimiter
\t\t\t\t})
\t\t\t});
`;

const duplicateProbeBlock = `\t\t\trequestStages.push({
\t\t\t\tname: "gateway-probes",
\t\t\t\trun: () => handleGatewayProbeRequest(req, res, requestPath, resolvedAuth, trustedProxies, allowRealIpFallback, getReadiness)
\t\t\t});
\t\t\tif (await runGatewayHttpRequestStages(requestStages)) return;`;

if (gatewaySrc.includes(duplicateProbeBlock)) {
  gatewaySrc = gatewaySrc.replace(
    duplicateProbeBlock,
    "\t\t\tif (await runGatewayHttpRequestStages(requestStages)) return;"
  );
}

gatewaySrc = gatewaySrc.replaceAll(
  "params.refreshGatewayHealthSnapshot({ probe: true })",
  "params.refreshGatewayHealthSnapshot({ probe: false })"
);

const maintenanceTimersNeedle = "function startGatewayMaintenanceTimers(params) {";
if (gatewaySrc.includes(maintenanceTimersNeedle) && !gatewaySrc.includes("skipping gateway maintenance timers for creator runtime")) {
  gatewaySrc = gatewaySrc.replace(
    maintenanceTimersNeedle,
    `function startGatewayMaintenanceTimers(params) {
\tparams?.log?.info?.("skipping gateway maintenance timers for creator runtime");
\treturn {
\t\ttickInterval: null,
\t\thealthInterval: null,
\t\tdedupeCleanup: null,
\t\tmediaCleanup: null
\t};
`
  );
} else if (!gatewaySrc.includes("skipping gateway maintenance timers for creator runtime")) {
  throw new Error("Unable to patch gateway maintenance timers; expected marker not found.");
}

const channelHealthMonitorNeedle = "function startGatewayChannelHealthMonitor(params) {";
if (gatewaySrc.includes(channelHealthMonitorNeedle) && !gatewaySrc.includes("skipping channel health monitor for creator runtime")) {
  gatewaySrc = gatewaySrc.replace(
    channelHealthMonitorNeedle,
    `function startGatewayChannelHealthMonitor(params) {
\tparams?.log?.info?.("skipping channel health monitor for creator runtime");
\treturn null;
`
  );
} else if (!gatewaySrc.includes("skipping channel health monitor for creator runtime")) {
  throw new Error("Unable to patch channel health monitor; expected marker not found.");
}

gatewaySrc = gatewaySrc.replace(
  "stopModelPricingRefresh: !params.minimalTestGateway && !isVitestRuntimeEnv() ? startGatewayModelPricingRefresh({ config: params.cfgAtStart }) : () => {}",
  "stopModelPricingRefresh: () => {}"
);

writeFileSync(gatewayServerPath, gatewaySrc);

// Sprint B.3 — runtime-layer outbound firewall. Wraps
// `sendTextChunks` so the validate_outbound_send check fires once per
// payload (before per-chunk splitting) for every channel handler the
// gateway creates. Same fail-open-on-infra-failure semantics as the
// claw-messenger send.js firewall; throws `send-blocked: ...` on a
// `{ok:false}` verdict so the LLM loop sees the failure and redrafts.
//
// Injection point: top of `sendTextChunks` body in
// `deliver-BAZ1LU-l.js::deliverOutboundPayloadsCore`. Marker is the
// exact arrow-fn header from openclaw 2026.4.23; if upstream renames
// or relocates this helper, the patch fails loud (consistent with the
// other patches in this script).
if (!deliverSrc.includes("async function validateOutboundOrThrowRuntime(")) {
  const deliverFirewallHelper = `async function validateOutboundOrThrowRuntime(text) {
\tconst creatorId = process.env.MAYA_CREATOR_ID;
\tconst httpBase = process.env.MAYA_CONVEX_HTTP_BASE;
\tconst secret = process.env.WEBHOOK_INTERNAL_SECRET;
\tif (!creatorId || !httpBase || !secret) return;
\tconst body = typeof text === "string" ? text : "";
\tif (!body.trim()) return;
\tlet res;
\ttry {
\t\tres = await fetch(\`\${httpBase}/lc_maya/validate_outbound_send\`, {
\t\t\tmethod: "POST",
\t\t\theaders: { "content-type": "application/json" },
\t\t\tbody: JSON.stringify({ secret, creatorId, message: body }),
\t\t});
\t} catch (err) {
\t\tconsole.warn("[firewall:runtime] validate_outbound_send network failure, allowing send:", String(err));
\t\treturn;
\t}
\tif (!res.ok) {
\t\tconsole.warn(\`[firewall:runtime] validate_outbound_send returned HTTP \${res.status}, allowing send\`);
\t\treturn;
\t}
\tlet payload;
\ttry { payload = await res.json(); } catch { return; }
\tif (payload && payload.ok === false) {
\t\tconst reasons = Array.isArray(payload.blockedReasons) ? payload.blockedReasons.join("; ") : "blocked";
\t\tconst fix = payload.suggestedFix ? \` Fix: \${payload.suggestedFix}\` : "";
\t\tthrow new Error(\`send-blocked: \${reasons}.\${fix}\`);
\t}
}
`;

  const sendTextChunksNeedle = `\tconst sendTextChunks = async (text, overrides) => {
\t\tthrowIfAborted(abortSignal);`;
  if (!deliverSrc.includes(sendTextChunksNeedle)) {
    throw new Error("Unable to patch deliver-runtime sendTextChunks; expected marker not found.");
  }
  deliverSrc = deliverSrc.replace(
    sendTextChunksNeedle,
    `${deliverFirewallHelper}\tconst sendTextChunks = async (text, overrides) => {
\t\tthrowIfAborted(abortSignal);
\t\tawait validateOutboundOrThrowRuntime(text);`
  );
}

writeFileSync(deliverRuntimePath, deliverSrc);
