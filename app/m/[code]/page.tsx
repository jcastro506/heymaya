/**
 * One tap to send a pitch (2026-10-12). Maya texts this link; opening it puts the email she drafted straight into
 * Gmail's compose (to, subject, the message with the kit link), so the creator reads it and hits send from their
 * own account. Application answers (several to paste into a form) are shown here to copy. Only the draft's own
 * text, by an unguessable code, for 14 days. Not indexed.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readPublicDraft } from "@/lib/publicDraft";
import { OpenInGmail } from "./SendButtons";
import "./send.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your pitch, ready to send", robots: { index: false, follow: false } };

export default async function SendPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = await readPublicDraft(code);
  if (!d) notFound();
  if (d.channel === "email") {
    return (
      <main className="send">
        <p className="send-kicker">From Maya</p>
        <h1>Opening your pitch to {d.brand} in Gmail…</h1>
        <p className="send-help">Give it a read and hit send.</p>
        <OpenInGmail to={d.to} subject={d.subject} body={d.body} />
      </main>
    );
  }
  return (
    <main className="send">
      <p className="send-kicker">From Maya</p>
      <h1>{d.channel === "application" ? `Your ${d.brand} application` : `Your DM to ${d.brand}`}</h1>
      <p className="send-help">{d.channel === "application" ? "Paste each answer into their form, then submit." : "Paste it into their DMs and send."}</p>
      <section className="send-card">
        <div className="send-row"><span>{d.channel === "application" ? "Form" : "To"}</span><a href={d.to} target="_blank" rel="noreferrer">{d.to}</a></div>
        {d.channel === "application"
          ? d.answers.map((x) => (<div key={x.label} className="send-answer"><span>{x.label}</span><pre className="send-body">{x.answer}</pre></div>))
          : <pre className="send-body">{d.body}</pre>}
      </section>
      <p className="send-foot">Tell Maya once it&apos;s in, so she can keep track.</p>
    </main>
  );
}
