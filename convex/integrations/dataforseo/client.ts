/**
 * DataForSEO client (Sprint 2 — demand intelligence).
 *
 * HTTP basic-auth (DATAFORSEO_LOGIN = account email, DATAFORSEO_PASSWORD).
 * Every call soft-fails into a typed result instead of throwing, and detects the
 * common gates explicitly:
 *   - no creds set            → reason "no_creds"
 *   - account not verified    → reason "needs_verification" (the data endpoints
 *                               return "Please verify your account..." until the
 *                               operator verifies at app.dataforseo.com)
 *   - HTTP / network error    → reason "http_error"
 *   - task-level error / empty → reason "task_error" / "empty"
 *
 * Auth header uses btoa (web standard, available in the Convex runtime) — NOT
 * Node Buffer, so no "use node" pragma needed.
 */

const BASE = "https://api.dataforseo.com/v3";

function creds(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

export interface DfsResult<T> {
  ok: boolean;
  reason?:
    | "no_creds"
    | "needs_verification"
    | "http_error"
    | "task_error"
    | "empty";
  result: T[];
  cost?: number;
  message?: string;
  /** Echoed for task-based endpoints (reviews) so a caller can poll. */
  taskId?: string;
}

/**
 * POST a DataForSEO endpoint and normalize the (login → tasks[0].result) shape.
 * `path` is appended after /v3 (e.g. "/keywords_data/google_ads/search_volume/live").
 */
export async function dataForSeoPost<T>(
  path: string,
  body: unknown
): Promise<DfsResult<T>> {
  const c = creds();
  if (!c) {
    return {
      ok: false,
      reason: "no_creds",
      result: [],
      message: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set on this deployment.",
    };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(`${c.login}:${c.password}`),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, reason: "http_error", result: [], message: (err as Error).message };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "http_error",
      result: [],
      message: `HTTP ${res.status}: ${t.slice(0, 200)}`,
    };
  }
  const json = (await res.json().catch(() => null)) as {
    status_message?: string;
    cost?: number;
    tasks?: Array<{
      id?: string;
      status_code?: number;
      status_message?: string;
      result?: T[] | null;
    }>;
  } | null;
  if (!json) {
    return { ok: false, reason: "http_error", result: [], message: "unparseable response" };
  }
  const task = json.tasks?.[0];
  const combined = `${json.status_message ?? ""} ${task?.status_message ?? ""}`.toLowerCase();
  if (combined.includes("verify")) {
    return {
      ok: false,
      reason: "needs_verification",
      result: [],
      cost: json.cost,
      message:
        "DataForSEO account needs verification — complete it at app.dataforseo.com, then this works.",
    };
  }
  // task-level non-success (20000 = ok; 20100 = task created/queued for task-based)
  const code = task?.status_code ?? 0;
  if (code !== 0 && code !== 20000 && code !== 20100) {
    return {
      ok: false,
      reason: "task_error",
      result: [],
      cost: json.cost,
      taskId: task?.id,
      message: task?.status_message ?? "task error",
    };
  }
  const result = task?.result ?? [];
  if (!result || result.length === 0) {
    return {
      ok: false,
      reason: "empty",
      result: [],
      cost: json.cost,
      taskId: task?.id,
      message: task?.status_message ?? json.status_message,
    };
  }
  return { ok: true, result, cost: json.cost, taskId: task?.id };
}
