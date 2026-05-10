/**
 * Sprint 12.3 — HeyMaya product waitlist mutation.
 *
 * Public mutation called from the `/waitlist` landing page form. Accepts
 * an email + optional name + optional source; dedupes by lower-cased
 * email; writes/updates a row in `mayaProductWaitlist`.
 *
 * No auth required — landing page is public, and the table holds only
 * email + name. Cross-tenant isolation N/A (single-tenant table).
 */
import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const addToWaitlist = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.trim().toLowerCase();
    if (
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail) ||
      normalizedEmail.length > 254
    ) {
      throw new Error("invalid-email");
    }
    const existing = await ctx.db
      .query("mayaProductWaitlist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        signedUpAt: now,
        ...(args.name ? { name: args.name } : {}),
        ...(args.source ? { source: args.source } : {}),
      });
      return { ok: true, deduped: true } as const;
    }
    await ctx.db.insert("mayaProductWaitlist", {
      email: normalizedEmail,
      name: args.name,
      source: args.source ?? "homepage",
      signedUpAt: now,
    });
    return { ok: true, deduped: false } as const;
  },
});
