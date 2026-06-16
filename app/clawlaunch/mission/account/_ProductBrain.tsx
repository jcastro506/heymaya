"use client";

/**
 * W1.1 — "Product brain": Maya's working picture of the product (grounded,
 * read-only) above the founder's editable ground-truth. This is the
 * verification surface that makes autonomy (W2) safe — the founder sees what
 * Maya understands and corrects it before she posts. Edits persist to gtmApps
 * via updateProductContext and re-anchor APP.md on the next deploy.
 */

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import type { ProductPicture } from "@/convex/gtmMaya/productPicture";
import { Card, Pill } from "../_components";

const STAGES = ["idea", "live-beta", "paid", "unknown"] as const;
const WEEK_GOALS = [
  "feedback",
  "signups",
  "demos",
  "revenue",
  "unknown",
] as const;
const USER_BANDS = ["none", "1-100", "100-1k", "1k+", "unknown"] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PictureField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="font-mono text-xs uppercase tracking-wide text-paper-faint">
        {label}
      </p>
      <p className="text-sm text-paper">{value}</p>
    </div>
  );
}

function MayaPicture({ picture }: { picture: ProductPicture }) {
  const tone: "lime" | "paper" | "rose" =
    picture.confidence === "high"
      ? "lime"
      : picture.confidence === "medium"
        ? "paper"
        : "rose";
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-base text-paper">{picture.promise}</p>
        <Pill tone={tone}>{picture.confidence} confidence</Pill>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PictureField label="What it does" value={picture.whatItDoes} />
        <PictureField label="Who it's for" value={picture.whoItsFor} />
        <PictureField label="Differentiator" value={picture.differentiator} />
        <PictureField label="Category" value={picture.category} />
        {picture.pricing ? (
          <PictureField label="Pricing" value={picture.pricing} />
        ) : null}
      </div>

      {picture.competitors.length > 0 ? (
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-wide text-paper-faint">
            Competitors
          </p>
          <div className="flex flex-wrap gap-1.5">
            {picture.competitors.map((c) => (
              <Pill key={c}>{c}</Pill>
            ))}
          </div>
        </div>
      ) : null}

      {picture.proofPoints.length > 0 ? (
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-wide text-paper-faint">
            Proof points
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-paper-dim">
            {picture.proofPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {picture.gaps.length > 0 ? (
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-wide text-paper-faint">
            Still verifying
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-paper-dim">
            {picture.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {picture.sources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-paper-faint/15 pt-3">
          <span className="font-mono text-xs uppercase tracking-wide text-paper-faint">
            Sources
          </span>
          {picture.sources.map((s) => (
            <span
              key={s}
              className="rounded bg-paper-faint/10 px-1.5 py-0.5 font-mono text-xs text-paper-dim"
            >
              {s.startsWith("http") ? hostOf(s) : s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-xs uppercase tracking-wide text-paper-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ProductBrain({ app }: { app: Doc<"gtmApps"> | null }) {
  const update = useMutation(
    api.gtmMaya.researchLifecycle.updateProductContext
  );
  const picture =
    (app?.diagnosis as { picture?: ProductPicture } | undefined)?.picture ??
    null;

  const [name, setName] = useState("");
  const [differentiator, setDifferentiator] = useState("");
  const [founderWhy, setFounderWhy] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("unknown");
  const [weekGoal, setWeekGoal] =
    useState<(typeof WEEK_GOALS)[number]>("unknown");
  const [userCountBand, setUserCountBand] =
    useState<(typeof USER_BANDS)[number]>("unknown");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Seed the form once the app loads (keyed on _id so reactive updates after a
  // save don't clobber an in-progress edit).
  useEffect(() => {
    if (!app) return;
    setName(app.name ?? "");
    setDifferentiator(app.differentiator ?? "");
    setFounderWhy(app.founderWhy ?? "");
    setStage((app.stage as (typeof STAGES)[number]) ?? "unknown");
    setWeekGoal((app.weekGoal as (typeof WEEK_GOALS)[number]) ?? "unknown");
    setUserCountBand(
      (app.userCountBand as (typeof USER_BANDS)[number]) ?? "unknown"
    );
  }, [app?._id]);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await update({
        name: name.trim() || undefined,
        differentiator: differentiator.trim() || undefined,
        founderWhy: founderWhy.trim() || undefined,
        stage,
        weekGoal,
        userCountBand,
      });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        {picture ? (
          <MayaPicture picture={picture} />
        ) : (
          <p className="text-sm text-paper-dim">
            Maya is still building her picture of your product. It appears here
            after her first research pass — then you can confirm or correct it.
          </p>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-sm text-paper-dim">
          Your ground truth. Correct anything Maya got wrong — she uses this as
          the anchor for every post, so accuracy here is what keeps her honest.
        </p>
        <div className="space-y-4">
          <Labeled label="Product name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your product's name"
            />
          </Labeled>
          <Labeled label="What's different about it (the wedge)">
            <textarea
              className="input min-h-[80px]"
              value={differentiator}
              onChange={(e) => setDifferentiator(e.target.value)}
              placeholder="In your words — what it does and why it's different"
            />
          </Labeled>
          <Labeled label="Why you built it">
            <textarea
              className="input min-h-[60px]"
              value={founderWhy}
              onChange={(e) => setFounderWhy(e.target.value)}
              placeholder="The problem you're solving"
            />
          </Labeled>
          <div className="grid gap-4 sm:grid-cols-3">
            <Labeled label="Stage">
              <select
                className="input"
                value={stage}
                onChange={(e) =>
                  setStage(e.target.value as (typeof STAGES)[number])
                }
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="This week's goal">
              <select
                className="input"
                value={weekGoal}
                onChange={(e) =>
                  setWeekGoal(e.target.value as (typeof WEEK_GOALS)[number])
                }
              >
                {WEEK_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Users so far">
              <select
                className="input"
                value={userCountBand}
                onChange={(e) =>
                  setUserCountBand(e.target.value as (typeof USER_BANDS)[number])
                }
              >
                {USER_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Labeled>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-lime px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save corrections"}
            </button>
            {saved ? (
              <span className="text-xs text-paper-dim">
                Saved — Maya re-grounds on your next research pass.
              </span>
            ) : null}
            {err ? <span className="text-xs text-[#b3261e]">{err}</span> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
