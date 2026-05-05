"use client";

/**
 * Growth-product dashboard — `/growth/dashboard` (post-onboarding).
 *
 * The public marketing landing lives at `/growth`; signed-in operators
 * reach this page via the post-onboarding redirect or by direct nav.
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function GrowthDashboardPage() {
  const me = useQuery(api.onboarding.growth.pipeline.getMyGrowthAgent);

  if (me === undefined) {
    return (
      <Shell>
        <p className="text-paper-faint">Loading…</p>
      </Shell>
    );
  }
  if (me === null) {
    return (
      <Shell>
        <p className="text-paper">
          Sign in first.{" "}
          <Link href="/sign-in" className="text-paper underline">
            Sign in
          </Link>
          .
        </p>
      </Shell>
    );
  }
  if (!me.agent) {
    return (
      <Shell>
        <p className="mb-4 text-paper">No Builder Maya yet. Let&rsquo;s set her up.</p>
        <Link
          href="/onboarding/growth"
          className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white"
        >
          Start onboarding →
        </Link>
      </Shell>
    );
  }

  const agent = me.agent;
  const onboardingDone = agent.onboardingStep === "complete";
  const linkedinReady = Boolean(agent.linkedinConnection);
  const twitterReady = Boolean(agent.twitterConnection);
  const productReady = Boolean(agent.productContext?.productName);
  const samplesReady =
    (agent.voiceSamples?.linkedin?.length ?? 0) > 0 ||
    (agent.voiceSamples?.twitter?.length ?? 0) > 0;

  return (
    <Shell>
      <div className="mb-10">
        <p className="mb-2 font-mono text-xs uppercase tracking-widest text-paper-faint">
          Maya for Builders
        </p>
        <h1 className="font-serif text-4xl">
          {agent.productContext?.productName
            ? `Building hype for ${agent.productContext.productName}.`
            : "Your AI distribution manager."}
        </h1>
      </div>

      {!onboardingDone && (
        <div className="mb-10 rounded-2xl border border-paper-faint/30 bg-paper/5 p-6">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-paper">
            Onboarding incomplete
          </p>
          <p className="mb-4 text-paper-dim">
            Currently on step:{" "}
            <span className="text-paper">{agent.onboardingStep}</span>
          </p>
          <Link
            href="/onboarding/growth"
            className="rounded-full bg-paper px-6 py-2 text-xs font-medium text-ink hover:bg-white"
          >
            Resume onboarding →
          </Link>
        </div>
      )}

      <section className="mb-10 grid gap-4 sm:grid-cols-2">
        <Card title="LinkedIn">
          <Status ok={linkedinReady} label={linkedinReady ? "Connected" : "Not connected"} />
        </Card>
        <Card title="X / Twitter">
          <Status ok={twitterReady} label={twitterReady ? "Connected" : "Not connected"} />
        </Card>
        <Card title="Product context">
          <Status ok={productReady} label={productReady ? "Set" : "Missing"} />
        </Card>
        <Card title="Voice samples">
          <Status
            ok={samplesReady}
            label={
              samplesReady
                ? `${agent.voiceSamples?.linkedin?.length ?? 0} LI · ${agent.voiceSamples?.twitter?.length ?? 0} X`
                : "Missing"
            }
          />
        </Card>
      </section>

      <section className="mb-10 rounded-2xl border border-paper-faint/15 bg-ink-2 p-6">
        <h2 className="mb-2 font-serif text-xl">Drafts pending approval</h2>
        <p className="text-sm text-paper-faint">
          {agent.rileyFlyAppId
            ? "No drafts pending. Maya will surface them here when ready."
            : "Maya isn't deployed yet. Once she's running, her drafts land here for your approval."}
        </p>
      </section>

      <section className="mb-10 rounded-2xl border border-paper-faint/15 bg-ink-2 p-6">
        <h2 className="mb-2 font-serif text-xl">Maya&rsquo;s machine</h2>
        {agent.rileyFlyAppId ? (
          <div className="text-sm text-paper-dim">
            <p className="mb-1">
              Fly app:{" "}
              <code className="rounded bg-ink-3 px-2 py-1 font-mono text-xs text-paper">
                {agent.rileyFlyAppId}
              </code>
            </p>
            <p>
              Deployed:{" "}
              {agent.deployedAt
                ? new Date(agent.deployedAt).toLocaleString()
                : "—"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-paper-faint">
            Not deployed. Wave C wires the deploy pipeline; until then,
            Maya is waiting for her runtime.
          </p>
        )}
      </section>

      <footer className="border-t border-paper-faint/15 pt-6 text-xs text-paper-faint">
        Account: {me.creator.email}
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-6 py-16">{children}</div>
    </main>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-paper-faint/15 bg-ink-2 p-5">
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-paper-faint">
        {title}
      </p>
      {children}
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className={ok ? "text-paper" : "text-red-400"}>
      <span className="mr-2">{ok ? "✓" : "·"}</span>
      {label}
    </p>
  );
}
