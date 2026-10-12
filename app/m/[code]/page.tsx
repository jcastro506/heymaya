/**
 * One tap to send a pitch (2026-10-12). Maya texts this link; it opens the email she drafted with Gmail or Mail
 * ready to go (to, subject, the message with the kit link), or copies a DM or application answers. The
 * creator reads it and hits send from their own account. Only the draft's own text is shown, by an
 * unguessable code, for 14 days. Not indexed.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { PublicDraft } from "@/convex/partnerships/drafts";
import { SendButtons, CopyButton } from "./SendButtons";
import "./send.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your pitch, ready to send", robots: { index: false, follow: false } };

async function read(code: string): Promise<PublicDraft | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return await new ConvexHttpClient(url).query(api.partnerships.drafts.publicDraft, { code }).catch(() => null);
}

export default async function SendPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const d = await read(code);
  if (!d) notFound();
  const title = d.channel === "email" ? `Your pitch to ${d.brand}` : d.channel === "application" ? `Your ${d.brand} application` : `Your DM to ${d.brand}`;
  return (
    <main className="send">
      <p className="send-kicker">From Maya</p>
      <h1>{title}</h1>
      <p className="send-help">
        {d.channel === "email" ? "Give it a read, then open it in your email and hit send." : d.channel === "application" ? "Copy each answer into their form, then submit." : "Copy it, then send it from your account."}
      </p>

      {d.channel === "email" ? (
        <>
          <SendButtons to={d.to} subject={d.subject} body={d.body} />
          <section className="send-card">
            <div className="send-row"><span>To</span><b>{d.to}</b><CopyButton text={d.to} label="Copy" /></div>
            <div className="send-row"><span>Subject</span><b>{d.subject}</b><CopyButton text={d.subject} label="Copy" /></div>
            <pre className="send-body">{d.body}</pre>
            <CopyButton text={d.body} label="Copy the message" wide />
          </section>
        </>
      ) : d.channel === "application" ? (
        <section className="send-card">
          <div className="send-row"><span>Form</span><a href={d.to} target="_blank" rel="noreferrer">{d.to}</a></div>
          {d.answers.map((x) => (
            <div key={x.label} className="send-answer">
              <span>{x.label}</span>
              <pre className="send-body">{x.answer}</pre>
              <CopyButton text={x.answer} label="Copy" />
            </div>
          ))}
        </section>
      ) : (
        <section className="send-card">
          <div className="send-row"><span>To</span><a href={d.to} target="_blank" rel="noreferrer">{d.to}</a></div>
          <pre className="send-body">{d.body}</pre>
          <CopyButton text={d.body} label="Copy the DM" wide />
        </section>
      )}
      <p className="send-foot">It sends from your own account. Tell Maya once it&apos;s out, and forward her anything they write back.</p>
    </main>
  );
}
