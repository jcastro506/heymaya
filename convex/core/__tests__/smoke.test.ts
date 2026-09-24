import { describe, expect, it } from "vitest";
import { integrationReadiness } from "../smoke";

describe("integration readiness", () => {
  it("names each missing production dependency instead of silently skipping it", () => {
    const rows = integrationReadiness({ ZERNIO_API_KEY: "key", ZERNIO_WEBHOOK_SECRET: "secret", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", APP_URL: "https://example.com" });
    expect(rows.find((row) => row.vendor === "zernio")?.ok).toBe(true);
    expect(rows.find((row) => row.vendor === "claw")).toMatchObject({ ok: false, detail: { apiKey: false, lineNumber: false, relayUrl: false, webhookSecret: false } });
    expect(rows.find((row) => row.vendor === "google")?.ok).toBe(true);
    expect(rows.find((row) => row.vendor === "gmail")).toMatchObject({ ok: false, detail: { redirectUri: false, sendingEnabled: false } });
  });
});
