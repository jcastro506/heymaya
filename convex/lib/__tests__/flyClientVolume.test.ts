import { describe, expect, it } from "vitest";
import { FlyClient } from "../flyClient";

/**
 * Phase 3 — findOrCreateVolume must REUSE an existing in-region volume (per-
 * tenant apps run one machine + one volume; creating a second would orphan the
 * old one and lose the memory it holds) and only CREATE when none exists.
 */

type Call = { method: string; url: string; body?: unknown };

function fakeFly(
  volumesResponse: Array<Record<string, unknown>>,
  createdVolume: Record<string, unknown>
): { client: FlyClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });
    const payload =
      method === "POST" ? createdVolume : volumesResponse;
    return {
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const client = new FlyClient({
    apiToken: "test-token",
    region: "iad",
    fetchImpl,
  });
  return { client, calls };
}

describe("FlyClient.findOrCreateVolume", () => {
  it("REUSES an existing in-region volume (no POST)", async () => {
    const { client, calls } = fakeFly(
      [{ id: "vol_existing", name: "maya_data", region: "iad", state: "created" }],
      { id: "vol_new", name: "maya_data", region: "iad" }
    );
    const vol = await client.findOrCreateVolume("clawlaunch-x", {
      name: "maya_data",
      sizeGb: 1,
    });
    expect(vol.id).toBe("vol_existing");
    expect(calls.some((c) => c.method === "POST")).toBe(false); // never created a 2nd
  });

  it("CREATES when the app has no volume", async () => {
    const { client, calls } = fakeFly([], {
      id: "vol_new",
      name: "maya_data",
      region: "iad",
    });
    const vol = await client.findOrCreateVolume("clawlaunch-x", {
      name: "maya_data",
      sizeGb: 1,
    });
    expect(vol.id).toBe("vol_new");
    const post = calls.find((c) => c.method === "POST");
    expect(post).toBeTruthy();
    expect((post!.body as { size_gb: number }).size_gb).toBe(1);
    expect((post!.body as { region: string }).region).toBe("iad");
  });

  it("ignores destroyed / wrong-region volumes and creates a fresh one", async () => {
    const { client, calls } = fakeFly(
      [
        { id: "vol_dead", name: "maya_data", region: "iad", state: "destroyed" },
        { id: "vol_lax", name: "maya_data", region: "lax", state: "created" },
      ],
      { id: "vol_fresh", name: "maya_data", region: "iad" }
    );
    const vol = await client.findOrCreateVolume("clawlaunch-x", {
      name: "maya_data",
      sizeGb: 1,
    });
    expect(vol.id).toBe("vol_fresh");
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });
});
