import { notFound } from "next/navigation";
import AppLayout from "../app/layout";

/** Dev-only visual fixture for the authenticated Mission Control shell. */
export default function MissionControlPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <section>
          <p className="text-xs uppercase tracking-[.16em] opacity-50">Saturday, September 12</p>
          <h1 className="mt-2">Here’s what we’re trying this week.</h1>
          <p className="text-sm opacity-70 mt-3">Your ideas, the moments behind them, and what Maya is keeping an eye on.</p>
        </section>
        <section className="border border-white/10 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wide opacity-50">Ready when you are</p>
          <h2 className="text-lg mt-2">The honest mile-18 check-in</h2>
          <p className="text-sm opacity-70 mt-2">A quick camera-facing update from the marathon build. The tired part is the story.</p>
          <div className="flex gap-3 mt-4 text-xs"><button className="underline">the version</button><button className="underline opacity-70">save it</button></div>
        </section>
        <section>
          <h2 className="text-sm uppercase tracking-wide opacity-50">Maya noticed</h2>
          <div className="border-b border-white/5 py-3 text-sm">Short training updates are moving in your lane this week.</div>
        </section>
      </div>
    </AppLayout>
  );
}
