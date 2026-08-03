"use client";

/**
 * Start a v2 machine (§18 Sprint 2.9).
 *
 * Deliberately plain. This is NOT Sprint 11's onboarding — that's a designed
 * six-screen experience with a streaming read of the founder's URL, a
 * correction that becomes a directive, connect cards, and payment, and it
 * depends on a perception layer that doesn't exist yet.
 *
 * This is the plumbing underneath it: name the product, pair Telegram, deploy.
 * Keeping them separate is what stops the real onboarding being quietly
 * pre-decided by whatever was expedient the day someone needed a test machine.
 */

import { useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { SignOutButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

type DeployResult =
  | { ok: true; appName: string; machineId: string }
  | { ok: false; error: string };

export default function MayaSetupPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const state = useQuery(api.maya.setup.myState, isAuthenticated ? {} : "skip");
  const saveProduct = useMutation(api.maya.setup.saveProduct);
  const deployMine = useAction(api.maya.setup.deployMine);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<null | "saving" | "deploying">(null);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<DeployResult | null>(null);

  if (isLoading) return <Shell>Loading…</Shell>;
  if (!isAuthenticated) {
    return (
      <Shell>
        <p className="text-neutral-400">Sign in to start a machine.</p>
      </Shell>
    );
  }
  if (!state) return <Shell>Loading…</Shell>;

  const hasProduct = Boolean(state.productName && state.productUrl);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("saving");
    try {
      const res = await saveProduct({
        productName: name,
        productUrl: url,
        // The founder's real zone — the heartbeat's waking hours and every cron
        // expression resolve against it, so a wrong value here is an agent that
        // briefs at 3am or never wakes at all.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!res.ok) setError(res.error ?? "couldn't save that");
    } finally {
      setBusy(null);
    }
  }

  async function onDeploy() {
    setError(null);
    setBusy("deploying");
    try {
      const res = (await deployMine({})) as DeployResult;
      setDeployed(res);
      if (!res.ok) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <h1 className="text-2xl font-medium text-neutral-100">Start a machine</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Operator tool. The real onboarding is Sprint 11.
      </p>

      {/* 1 — the product */}
      <Section step="1" title="What are we promoting?" done={hasProduct}>
        {hasProduct ? (
          <p className="text-sm text-neutral-300">
            {state.productName} —{" "}
            <span className="text-neutral-500">{state.productUrl}</span>
          </p>
        ) : (
          <form onSubmit={onSave} className="flex flex-col gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product name"
              className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourproduct.com"
              className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-600"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="self-start rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
            >
              {busy === "saving" ? "Saving…" : "Save"}
            </button>
          </form>
        )}
      </Section>

      {/* 2 — Telegram */}
      <Section step="2" title="Pair Telegram" done={state.telegramPaired}>
        {state.telegramPaired ? (
          <p className="text-sm text-neutral-300">Paired. She can reach you.</p>
        ) : (
          <p className="text-sm text-neutral-400">
            Message the bot and send <code className="text-neutral-200">/start</code>.
            {" "}
            <span className="text-neutral-500">
              She can deploy without this, but she&rsquo;ll have nowhere to talk
              to you — so a brief would be written and never delivered.
            </span>
          </p>
        )}
      </Section>

      {/* 3 — deploy */}
      <Section step="3" title="Deploy" done={state.deployed}>
        {state.deployed && state.flyAppId ? (
          <p className="text-sm text-neutral-300">
            Running as{" "}
            <code className="text-neutral-200">{state.flyAppId}</code>
          </p>
        ) : (
          <>
            <button
              onClick={onDeploy}
              disabled={!hasProduct || busy !== null}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-30"
            >
              {busy === "deploying" ? "Deploying…" : "Deploy"}
            </button>
            <p className="mt-2 text-xs text-neutral-600">
              One always-on machine. Roughly $6/month plus model usage.
            </p>
          </>
        )}
      </Section>

      {error && (
        <p className="mt-6 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {deployed?.ok && (
        <p className="mt-6 rounded-md border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Machine <code>{deployed.machineId}</code> on{" "}
          <code>{deployed.appName}</code>. Text her.
        </p>
      )}

      <div className="mt-10 text-xs text-neutral-600">
        <SignOutButton>
          <button className="underline">Sign out</button>
        </SignOutButton>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-lg px-6 py-16">{children}</main>
  );
}

function Section({
  step,
  title,
  done,
  children,
}: {
  step: string;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-neutral-900 pt-6">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-400">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
            done
              ? "bg-emerald-500 text-neutral-950"
              : "bg-neutral-800 text-neutral-400"
          }`}
        >
          {done ? "✓" : step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
