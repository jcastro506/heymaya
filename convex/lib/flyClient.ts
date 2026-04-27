/**
 * Thin Fly.io Machines API client.
 *
 * v0 scope:
 *  - One Maya == one Fly app == one Fly machine. We pin to a single
 *    image-per-deploy and wire the OpenClaw bootstrap config in via env vars
 *    + Fly secrets.
 *  - Lifecycle covered: createApp, createMachine, getMachine, startMachine,
 *    stopMachine, destroyMachine, listMachines, machineLogs.
 *  - All calls go through the public Machines REST API
 *    (https://machines.fly.dev/) authed with FLY_API_TOKEN.
 *
 * This file is shared infra. Both Maya's solo deploy variant
 * (convex/onboarding/maya/deployMaya.ts) and any future LaunchCrew-style
 * multi-employee deploys would use the same client.
 *
 * Errors:
 *   `FlyError` carries status + body so the caller can decide whether to
 *   retry or surface a structured failure. Network errors are wrapped with
 *   status=null.
 *
 * Note re: OpenClaw 2026.4.23 deploy contract — this client doesn't know what
 * OpenClaw expects on disk; that shape is owned by `configGeneratorMaya.ts`
 * and rendered into the machine's bootstrap env. The lead must verify the env
 * shape against current OpenClaw 2026.4.23 docs (see configGeneratorMaya report).
 */

const DEFAULT_BASE = "https://api.machines.dev/v1";

export interface FlyClientOptions {
  apiToken?: string;
  orgSlug?: string;
  region?: string;
  baseUrl?: string;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class FlyError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly body: string | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "FlyError";
  }
}

export interface FlyMachineConfig {
  /** OCI image, e.g. "registry.fly.io/heymaya-openclaw:v2026.4.23" */
  image: string;
  env?: Record<string, string>;
  /** Fly mounts, optional. v0 uses an ephemeral root volume. */
  mounts?: Array<{
    volume: string;
    path: string;
  }>;
  services?: Array<{
    ports: Array<{ port: number; handlers?: string[] }>;
    protocol: string;
    internal_port: number;
  }>;
  guest?: {
    cpu_kind: "shared" | "performance";
    cpus: number;
    memory_mb: number;
  };
  restart?: {
    policy: "no" | "always" | "on-failure";
    max_retries?: number;
  };
  /** Arbitrary metadata Fly stores with the machine — handy for traceability. */
  metadata?: Record<string, string>;
  /** Optional explicit init command override. v0 uses image default. */
  init?: {
    cmd?: string[];
    entrypoint?: string[];
  };
}

export interface CreateMachineInput {
  appName: string;
  /** Machine name. v0 uses `maya-{creatorIdShort}`. Fly auto-generates if omitted. */
  name?: string;
  region?: string;
  config: FlyMachineConfig;
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id?: string;
  private_ip?: string;
  config: FlyMachineConfig;
  created_at?: string;
  updated_at?: string;
}

export interface CreateAppInput {
  appName: string;
  orgSlug?: string;
  network?: string;
}

export class FlyClient {
  private readonly apiToken: string;
  private readonly defaultOrg: string | undefined;
  private readonly defaultRegion: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FlyClientOptions = {}) {
    const apiToken = opts.apiToken ?? process.env.FLY_API_TOKEN;
    if (!apiToken) {
      throw new Error(
        "FlyClient: FLY_API_TOKEN not set. Provide opts.apiToken or set the env var."
      );
    }
    this.apiToken = apiToken;
    this.defaultOrg = opts.orgSlug ?? process.env.FLY_ORG_SLUG ?? undefined;
    this.defaultRegion = opts.region ?? process.env.FLY_REGION ?? "iad";
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /* ---------------------------- App lifecycle ---------------------------- */

  async createApp(input: CreateAppInput): Promise<{ name: string }> {
    const org = input.orgSlug ?? this.defaultOrg;
    if (!org) {
      throw new Error(
        "FlyClient.createApp: orgSlug required (set FLY_ORG_SLUG or pass orgSlug)."
      );
    }
    const body = {
      app_name: input.appName,
      org_slug: org,
      ...(input.network ? { network: input.network } : {}),
    };
    await this.fetchJson("POST", `/apps`, body);
    return { name: input.appName };
  }

  async destroyApp(appName: string): Promise<void> {
    await this.fetchJson("DELETE", `/apps/${encodeURIComponent(appName)}`);
  }

  /* ---------------------------- Secrets --------------------------------- */
  // Note: secrets on machines.dev are scoped to the app, not the machine.
  // Fly's GraphQL API has the most ergonomic secret-set surface, but the REST
  // /apps/{name}/secrets endpoint exists and is what we use here for v0.

  async setAppSecrets(
    appName: string,
    secrets: Record<string, string>
  ): Promise<void> {
    const body = { secrets };
    await this.fetchJson(
      "POST",
      `/apps/${encodeURIComponent(appName)}/secrets`,
      body
    );
  }

  /* --------------------------- Machine lifecycle ------------------------- */

  async createMachine(input: CreateMachineInput): Promise<FlyMachine> {
    const region = input.region ?? this.defaultRegion;
    const body = {
      ...(input.name ? { name: input.name } : {}),
      region,
      config: input.config,
    };
    const out = (await this.fetchJson(
      "POST",
      `/apps/${encodeURIComponent(input.appName)}/machines`,
      body
    )) as FlyMachine;
    return out;
  }

  async getMachine(appName: string, machineId: string): Promise<FlyMachine> {
    return (await this.fetchJson(
      "GET",
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`
    )) as FlyMachine;
  }

  async startMachine(appName: string, machineId: string): Promise<void> {
    await this.fetchJson(
      "POST",
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/start`
    );
  }

  async stopMachine(appName: string, machineId: string): Promise<void> {
    await this.fetchJson(
      "POST",
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/stop`
    );
  }

  async destroyMachine(
    appName: string,
    machineId: string,
    { force = false }: { force?: boolean } = {}
  ): Promise<void> {
    const qs = force ? "?force=true" : "";
    await this.fetchJson(
      "DELETE",
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}${qs}`
    );
  }

  async listMachines(appName: string): Promise<FlyMachine[]> {
    const out = await this.fetchJson(
      "GET",
      `/apps/${encodeURIComponent(appName)}/machines`
    );
    return Array.isArray(out) ? (out as FlyMachine[]) : [];
  }

  /**
   * Wait until the machine reaches `targetState` ("started" by default) or
   * until `timeoutMs` elapses. Polls `intervalMs` apart. Returns the final
   * machine row, or throws FlyError on timeout.
   */
  async waitForState(
    appName: string,
    machineId: string,
    targetState: string = "started",
    {
      timeoutMs = 60_000,
      intervalMs = 1_500,
    }: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<FlyMachine> {
    const start = Date.now();
    let last: FlyMachine | null = null;
    while (Date.now() - start < timeoutMs) {
      last = await this.getMachine(appName, machineId);
      if (last.state === targetState) return last;
      if (last.state === "failed" || last.state === "destroyed") {
        throw new FlyError(
          `Fly machine ${machineId} entered terminal state '${last.state}' before reaching '${targetState}'`,
          null,
          JSON.stringify(last),
          false
        );
      }
      await sleep(intervalMs);
    }
    throw new FlyError(
      `Fly machine ${machineId} did not reach '${targetState}' within ${timeoutMs}ms (last state: ${last?.state ?? "unknown"})`,
      null,
      last ? JSON.stringify(last) : null,
      true
    );
  }

  async machineLogs(
    appName: string,
    machineId: string,
    { sinceSec = 60 }: { sinceSec?: number } = {}
  ): Promise<string> {
    // Fly's logs endpoint is on a different host (api.fly.io) and returns NDJSON
    // for the GraphQL log query. We hit the simpler /apps/{name}/machines/{id}/events
    // endpoint here and return a stringified summary — sufficient for v0
    // troubleshooting; richer log streaming is a Sprint 7 concern.
    const events = (await this.fetchJson(
      "GET",
      `/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/events?since=${sinceSec}`
    )) as Array<{ timestamp?: string; type?: string; status?: string; source?: string }>;
    if (!Array.isArray(events) || events.length === 0) return "";
    return events
      .map(
        (e) =>
          `[${e.timestamp ?? ""}] ${e.source ?? ""} ${e.type ?? ""} ${e.status ?? ""}`.trim()
      )
      .join("\n");
  }

  /* ----------------------------- Internals ------------------------------- */

  private async fetchJson(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (networkErr) {
      throw new FlyError(
        `Fly network error on ${method} ${path}: ${(networkErr as Error).message}`,
        null,
        null,
        true
      );
    }
    const status = response.status;
    if (status >= 200 && status < 300) {
      // Some endpoints (DELETE, start, stop) return 204 No Content.
      if (status === 204) return null;
      const text = await safeText(response);
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    const text = await safeText(response);
    const retryable = status >= 500 && status < 600;
    throw new FlyError(
      `Fly HTTP ${status} on ${method} ${path}: ${text.slice(0, 500)}`,
      status,
      text,
      retryable
    );
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
