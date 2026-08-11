"use client";

import { useState } from "react";

/**
 * ⭐ §18.9.2's block ②: the live URL-read demo, pre-signup.
 *
 * Sprint 11's exit: *"a visitor can paste a URL on the landing page and watch
 * her be specifically right about their company, in under 20 seconds, without
 * signing up."*
 *
 * ## Why this block and not a testimonial
 *
 * Every competitor's landing page claims to understand your business. This one
 * demonstrates it on the visitor's own site, before they give us anything — and
 * it runs the **same read** a paying customer gets, so what they see here is
 * what they'd actually get.
 *
 * ## ⚠️ A failed read is shown, not swallowed
 *
 * "That page needs a login" and "that page loads with JavaScript" are the
 * honest, specific answers — and a visitor who pastes a docs URL learns
 * something true about us from getting a straight reason instead of a spinner
 * that ends in nothing. §12: honest silence beats fake activity, and an honest
 * *no* beats both.
 */
export function DemoRead() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "reading" }
    | { status: "done"; read: Record<string, string | string[] | undefined> }
    | { status: "failed"; detail: string }
  >({ status: "idle" });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || state.status === "reading") return;
    setState({ status: "reading" });

    try {
      const res = await fetch("/api/demo/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        read?: Record<string, string | string[] | undefined>;
        detail?: string;
      };
      if (data.ok && data.read) setState({ status: "done", read: data.read });
      else
        setState({
          status: "failed",
          detail: data.detail ?? "couldn't read that one",
        });
    } catch {
      // Network-level only. Everything else arrives as a 200 with `ok: false`,
      // because a specific refusal is more useful than a generic error.
      setState({ status: "failed", detail: "couldn't reach the reader — try again" });
    }
  }

  return (
    <section className="mx-auto w-full max-w-xl px-4 py-10">
      <h2 className="text-lg font-semibold text-paper">
        Paste your site. She&apos;ll tell you what you do.
      </h2>
      <p className="mt-1 text-sm text-paper-faint">
        No signup. This is the same read she does on day one.
      </p>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourproduct.com"
          aria-label="Your product's web address"
          className="min-w-0 flex-1 rounded border border-white/15 bg-transparent px-3 py-2 text-sm text-paper placeholder:text-paper-faint"
        />
        <button
          type="submit"
          disabled={state.status === "reading" || !url.trim()}
          className="rounded bg-paper px-4 py-2 text-sm font-medium text-ink disabled:opacity-40"
        >
          {state.status === "reading" ? "Reading…" : "Read it"}
        </button>
      </form>

      {state.status === "reading" && (
        <p className="mt-4 text-sm text-paper-faint">Reading your site…</p>
      )}

      {/* ⚠️ The specific reason, in her words. A generic "something went wrong"
          here would waste the most honest moment on the page. */}
      {state.status === "failed" && (
        <p className="mt-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {state.detail}
        </p>
      )}

      {state.status === "done" && (
        <dl className="mt-4 space-y-3 rounded border border-white/10 p-4">
          {(
            [
              ["What you do", state.read.whatItIs],
              ["Who it's for", state.read.whoItsFor],
              ["What's different", state.read.whatsDifferent],
            ] as const
          ).map(([label, value]) =>
            typeof value === "string" && value ? (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-paper-faint">
                  {label}
                </dt>
                <dd className="mt-0.5 text-sm text-paper">{value}</dd>
              </div>
            ) : null
          )}

          {/**
           * ⭐ The gaps are shown, not hidden.
           *
           * §2.7's honest half: what she could NOT establish from the page. It
           * is also the most persuasive thing here — a tool that admits what it
           * doesn't know reads as one that isn't guessing about the rest.
           */}
          {Array.isArray(state.read.gaps) && state.read.gaps.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-paper-faint">
                What she couldn&apos;t tell from your site
              </dt>
              <dd className="mt-0.5 text-sm text-paper-faint">
                {state.read.gaps.slice(0, 3).join(" · ")}
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
