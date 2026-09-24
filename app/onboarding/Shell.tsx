/**
 * The onboarding shell (2026-09-08): the landing page's room, carried through sign-up,
 * the five steps and the pairing screen. One brand mark, one eyebrow for where you are,
 * one column. The dashboard has its own shell.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import "./onboarding.css";

export function Flower({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <path d="M40 9C49-9 62 4 58 20C77 13 88 29 70 40C88 49 77 66 59 59C65 77 49 89 40 71C30 89 14 77 21 59C2 66-9 49 9 40C-9 30 3 14 21 21C14 3 30-9 40 9Z" fill="currentColor" />
      <circle cx="31" cy="36" r="3" fill="#29233F" />
      <circle cx="49" cy="36" r="3" fill="#29233F" />
      <path d="M31 47Q40 56 49 47" stroke="#29233F" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function OnboardShell({ where, children }: { where?: string; children: ReactNode }) {
  return (
    <main className="maya-onboard">
      <div className="onboard-frame">
        <div className="onboard-top">
          <Link href="/" className="maya-brand" aria-label="Maya home"><Flower />maya</Link>
          {where && <span className="maya-eyebrow"><span className="status-dot" aria-hidden="true" />{where}</span>}
        </div>
        {children}
      </div>
    </main>
  );
}
