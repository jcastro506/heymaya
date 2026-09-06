/**
 * §6 Sprint 4 named tests for connections: needsReconnect drives state (never a
 * token date) · zero accounts is "attention", never "connected" · the signature is
 * HMAC over the raw body · account rows normalise from either id field.
 */
import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { normalizeAccount, verifySignature } from "../../integrations/zernio";

describe("zernio integration", () => {
  it("verifies HMAC-SHA256 hex over the raw body, with or without the sha256= prefix, in constant time", async () => {
    const body = JSON.stringify({ type: "account.connected", profileId: "p1" });
    const hex = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(await verifySignature(body, hex, "s3cret")).toBe(true);
    expect(await verifySignature(body, `sha256=${hex}`, "s3cret")).toBe(true);
    expect(await verifySignature(body + " ", hex, "s3cret")).toBe(false);
    expect(await verifySignature(body, hex, "other")).toBe(false);
    expect(await verifySignature(body, null, "s3cret")).toBe(false);
  });

  it("normalises accounts from the list shape and the health shape", () => {
    expect(normalizeAccount({ _id: "a1", platform: "TikTok", username: "leah" }, true)).toMatchObject({ accountId: "a1", platform: "tiktok", username: "leah", needsReconnect: false, canFetchAnalytics: true });
    expect(normalizeAccount({ accountId: "a2", platform: "instagram", status: "needs_reconnect" })).toMatchObject({ accountId: "a2", needsReconnect: true });
    expect(normalizeAccount({ platform: "instagram" })).toBeNull();
  });
});

describe("connections rows", () => {
  it("profile is persisted first; zero accounts is attention; needsReconnect drives the state; forget clears", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: "prof_1" });
    const row = await t.query(internal.connections.zernio.connection, { creatorId });
    expect(row?.zernioProfileId).toBe("prof_1");
    expect(row?.status).toBe("attention");
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [] })).status).toBe("attention");
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [{ accountId: "a1", platform: "tiktok", username: "leah", needsReconnect: false, canFetchAnalytics: true }] })).status).toBe("connected");
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [{ accountId: "a1", platform: "tiktok", username: "leah", needsReconnect: true, canFetchAnalytics: true }] })).status).toBe("needs_reconnect");
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [{ accountId: "x", platform: "youtube", username: null, needsReconnect: false, canFetchAnalytics: true }] })).status).toBe("attention"); // not a platform we do
    const byProfile = await t.query(internal.connections.zernio.byProfile, { zernioProfileId: "prof_1" });
    expect(byProfile?.creatorId).toBe(creatorId);
    await t.mutation(internal.connections.zernio.forget, { creatorId });
    const after = await t.query(internal.connections.zernio.connection, { creatorId });
    expect(after?.status).toBe("disconnected");
    expect(after?.zernioProfileId).toBeUndefined();
  });
});

describe("connecting pulls the history once (the backfill had no caller until 2026-09-06)", () => {
  it("a newly reporting account schedules the backfill; the same account again does not; a second new one does", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { channel: { paired: true } }));
    await t.mutation(internal.connections.zernio.ensureProfileRow, { creatorId, zernioProfileId: "p1" });
    const acct = (id: string, over: Partial<{ needsReconnect: boolean; canFetchAnalytics: boolean }> = {}) => ({ accountId: id, platform: "tiktok", username: "leah", needsReconnect: false, canFetchAnalytics: true, ...over });
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct("a1")] })).backfill).toBe(true);
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct("a1")] })).backfill, "idempotent").toBe(false);
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct("a1"), acct("a2", { needsReconnect: true })] })).backfill, "needs_reconnect is not connected").toBe(false);
    expect((await t.mutation(internal.connections.zernio.applyAccounts, { creatorId, accounts: [acct("a1"), acct("a2")] })).backfill, "the second account, once it can report").toBe(true);
  });
});
