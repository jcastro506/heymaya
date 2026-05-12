import { readFileSync, writeFileSync } from "node:fs";

const channelPath = "/opt/openclaw-seed/extensions/claw-messenger/dist/channel.js";
const sendPath = "/opt/openclaw-seed/extensions/claw-messenger/dist/outbound/send.js";
const gatewayServerPath = "/usr/local/lib/node_modules/openclaw/dist/server.impl-DhtU4okW.js";
let src = readFileSync(channelPath, "utf8");
let sendSrc = readFileSync(sendPath, "utf8");
let gatewaySrc = readFileSync(gatewayServerPath, "utf8");

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

  if (!src.includes(needle)) {
    throw new Error("Unable to patch Claw Messenger actions interface; expected marker not found.");
  }

  src = src.replace(needle, replacement);
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

  if (!src.includes(needle)) {
    throw new Error("Unable to patch Claw Messenger account normalization; expected marker not found.");
  }

  src = src.replace(needle, replacement);
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

const gatewayStartHooksNeedle = `\tsidecarsPromise.then(async () => {
\t\tif (params.minimalTestGateway) return;
\t\tconst hookRunner = await runtimeDeps.getGlobalHookRunner();`;

if (gatewaySrc.includes(gatewayStartHooksNeedle)) {
  gatewaySrc = gatewaySrc.replace(
    gatewayStartHooksNeedle,
    `\tsidecarsPromise.then(async () => {
\t\tparams.log.info("skipping gateway_start hooks for creator runtime");
\t\treturn;
\t\tif (params.minimalTestGateway) return;
\t\tconst hookRunner = await runtimeDeps.getGlobalHookRunner();`
  );
} else if (!gatewaySrc.includes("skipping gateway_start hooks for creator runtime")) {
  throw new Error("Unable to patch gateway_start hooks; expected marker not found.");
}

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
