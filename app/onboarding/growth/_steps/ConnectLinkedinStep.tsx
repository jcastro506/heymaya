"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { OnboardingDraft } from "../_state";

export function ConnectLinkedinStep({
  draft,
  setDraft,
  onNext,
}: {
  draft: OnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>;
  onNext: () => Promise<void>;
}) {
  const markConnected = useMutation(
    api.onboarding.growth.pipeline.markPlatformConnected
  );
  const startOAuth = useAction(api.integrations.composio.oauth.startOAuth);
  const [submitting, setSubmitting] = useState(false);
  const [oauthing, setOauthing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountId = draft.linkedinComposioId;

  async function handleOAuth() {
    setError(null);
    setOauthing(true);
    try {
      const redirectUri = `${window.location.origin}/onboarding/growth?oauth=callback&provider=linkedin`;
      const { redirectUrl } = await startOAuth({
        provider: "linkedin",
        redirectUri,
      });
      window.location.assign(redirectUrl);
    } catch (e) {
      setError((e as Error).message);
      setOauthing(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!accountId.trim()) {
      setError("Paste the LinkedIn connectedAccountId from Composio first.");
      return;
    }
    setSubmitting(true);
    try {
      await markConnected({
        platform: "linkedin",
        composioAccountId: accountId.trim(),
      });
      await onNext();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h1 className="mb-3 font-serif text-3xl">Connect LinkedIn</h1>
      <p className="mb-6 max-w-xl text-paper-dim">
        Maya posts and reads engagement through your LinkedIn account.
        We use{" "}
        <a
          href="https://app.composio.dev/apps/linkedin"
          target="_blank"
          rel="noopener noreferrer"
          className="text-paper underline"
        >
          Composio
        </a>{" "}
        for OAuth — no LinkedIn developer app needed.
      </p>

      <button
        onClick={handleOAuth}
        disabled={oauthing}
        className="mb-8 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
      >
        {oauthing ? "Opening Composio..." : "Connect LinkedIn"}
      </button>

      <ol className="mb-8 space-y-3 rounded-2xl border border-paper-faint/15 bg-ink-2 p-6 text-sm text-paper-dim">
        <li>
          <span className="text-paper">Fallback 1.</span> Open{" "}
          <a
            href="https://app.composio.dev/apps/linkedin"
            target="_blank"
            rel="noopener noreferrer"
            className="text-paper underline"
          >
            app.composio.dev/apps/linkedin
          </a>{" "}
          and click <em>Connect</em>. Sign in with your LinkedIn account.
        </li>
        <li>
          <span className="text-paper">Fallback 2.</span> When the connection succeeds,
          Composio shows a{" "}
          <code className="rounded bg-ink-3 px-2 py-1 text-paper">
            connectedAccountId
          </code>{" "}
          like <code className="text-paper-faint">ca_xxxxxxxxxxxx</code>.
        </li>
        <li>
          <span className="text-paper">Fallback 3.</span> Paste it below.
        </li>
      </ol>

      <label className="mb-2 block text-xs font-mono uppercase tracking-widest text-paper-faint">
        LinkedIn connectedAccountId
      </label>
      <input
        type="text"
        value={accountId}
        onChange={(e) =>
          setDraft((d) => ({ ...d, linkedinComposioId: e.target.value }))
        }
        placeholder="ca_xxxxxxxxxxxx"
        className="mb-4 w-full rounded-xl border border-paper-faint/30 bg-ink-2 px-4 py-3 font-mono text-paper placeholder:text-paper-faint focus:border-paper-dim focus:outline-none"
      />

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Continue →"}
        </button>
      </div>
    </section>
  );
}
