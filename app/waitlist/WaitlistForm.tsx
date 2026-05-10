"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowRight, Check } from "lucide-react";
import { api } from "../../convex/_generated/api";

export function WaitlistForm() {
  const addToWaitlist = useMutation(
    api.waitlist.mayaProductWaitlist.addToWaitlist
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setErrorMsg(null);
    try {
      await addToWaitlist({ email: email.trim(), source: "homepage" });
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error && err.message.includes("invalid-email")
          ? "That doesn't look like a valid email."
          : "Something hiccuped on our end. Try again?"
      );
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-6">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-paper text-black">
          <Check className="h-5 w-5" />
        </div>
        <h2 className="mt-4 font-display text-2xl text-paper">
          You&apos;re on the list.
        </h2>
        <p className="mt-2 text-sm text-paper-dim">
          We&apos;ll text you when there&apos;s a seat. Until then — keep making
          stuff.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "submitting"}
          className="flex-1 rounded-md border border-[var(--hairline-strong)] bg-ink-2 px-4 py-3 text-base text-paper placeholder:text-paper-faint focus:border-paper focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-paper px-5 text-sm font-medium text-black transition hover:bg-white disabled:opacity-50"
        >
          {status === "submitting" ? "..." : "Join"}
          {status !== "submitting" && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
      {status === "error" && errorMsg && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}
    </form>
  );
}
