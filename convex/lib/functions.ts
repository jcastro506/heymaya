/**
 * The mutation builders every Convex mutation in this codebase uses, instead of the raw
 * ones in `_generated/server`. They wrap `ctx.db` so table triggers run on every write,
 * from any code path: today, one trigger keeps the `schedule` row (S0 #1) in step with
 * its creator. A sibling test fails if any module imports the raw builders.
 */
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { Triggers } from "convex-helpers/server/triggers";
import { internalMutation as rawInternalMutation, mutation as rawMutation } from "../_generated/server";
import type { DataModel } from "../_generated/dataModel";
import { syncSchedule } from "./scheduleRow";

const triggers = new Triggers<DataModel>();

triggers.register("creators", async (ctx, change) => {
  await syncSchedule(ctx.innerDb, change.id);
});

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));
