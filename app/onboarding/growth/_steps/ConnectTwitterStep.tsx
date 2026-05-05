"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { OnboardingDraft } from "../_state";

export function ConnectTwitterStep({
  draft,
  setDraft,
  onNext,
  onBack,
}: {
  draft: OnboardingDraft;
  setDraft: React.Dispatch<React.SetStateAction<OnboardingDraft>>;
  onNext: () => Promise<void>;
  onBack: () => Promise<void>;
}) {
  const markConnected = useMutation(
    api.onboarding.growth.pipeline.markPlatformConnected
  );
  const startOAuth = useAction(api.integrations.composio.oauth.startOAuth);
  const [submitting, setSubmitting] = useState(false);
  const [oauthing, setOauthing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountId = draft.twitterComposioId;

  async function handleOAuth() {
    setError(null);
    setOauthing(true);
    try {
      const redirectUri = `${window.location.origin}/onboarding/growth?oauth=callback&provider=twitter`;
      const { redirectUrl } = await startOAuth({
        provider: "twitter",
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
      setError("Paste the X connectedAccountId from Composio first.");
      return;
    }
    setSubmitting(true);
    try {
      await markConnected({
        platform: "twitter",
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
      <h1 className="mb-3 font-serif text-3xl">Connect X (Twitter)</h1>
      <p className="mb-6 max-w-xl text-paper-dim">
        X charges you per API call (~$0.001 / read, ~$0.01 / write). Maya&rsquo;s
        usage profile costs ~$2&ndash;5/month. Top up your X developer account
        with $10 and it lasts months.
      </p>

      <button
        onClick={handleOAuth}
        disabled={oauthing}
        className="mb-8 rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white disabled:opacity-50"
      >
        {oauthing ? "Opening Composio..." : "Connect X / Twitter"}
      </button>

      <ol className="mb-8 space-y-3 rounded-2xl border border-paper-faint/15 bg-ink-2 p-6 text-sm text-paper-dim">
        <li>
          <span className="text-paper">Fallback 1.</span> If you don&rsquo;t have one, sign up
          at{" "}
          <a
            href="https://developer.x.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-paper underline"
          >
            developer.x.com
          </a>{" "}
          (free tier OK; pay-per-use).
        </li>
        <li>
          <span className="text-paper">Fallback 2.</span> Open{" "}
          <a
            href="https://app.composio.dev/apps/twitter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-paper underline"
          >
            app.composio.dev/apps/twitter
          </a>{" "}
          and click <em>Connect</em>. Authorize with your X account.
        </li>
        <li>
          <span className="text-paper">Fallback 3.</span> Paste the connectedAccountId
          Composio shows you.
        </li>
      </ol>

      <label className="mb-2 block text-xs font-mono uppercase tracking-widest text-paper-faint">
        X connectedAccountId
      </label>
      <input
        type="text"
        value={accountId}
        onChange={(e) =>
          setDraft((d) => ({ ...d, twitterComposioId: e.target.value }))
        }
        placeholder="ca_xxxxxxxxxxxx"
        className="mb-4 w-full rounded-xl border border-paper-faint/30 bg-ink-2 px-4 py-3 font-mono text-paper placeholder:text-paper-faint focus:border-paper-dim focus:outline-none"
      />

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="rounded-full border border-paper-faint/30 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper"
        >
          ← Back
        </button>
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
