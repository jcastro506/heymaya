"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { MissionBoardData, MissionBoardItem } from "@/convex/gtmMaya/missionBoard";

export default function ClawLaunchMissionBoardPage() {
  const board = useQuery(api.gtmMaya.missionBoard.getMyMissionBoard);

  if (board === undefined) return <MissionBoardSkeleton />;
  if (board === null) return <MissionBoardEmpty />;

  return <MissionBoard board={board} />;
}

export function MissionBoard({ board }: { board: MissionBoardData }) {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <section className="border-b border-paper-faint/15 px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/clawlaunch"
              className="font-mono text-xs uppercase tracking-[0.22em] text-lime"
            >
              ClawLaunch
            </Link>
            <h1 className="mt-4 font-display text-4xl leading-none sm:text-6xl">
              {board.appName}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-paper-dim sm:text-base">
              Maya&apos;s current source of truth: what she knows, what she is
              doing today, what needs approval, and what is producing customer
              movement.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-80">
            <Stat label="Stage" value={board.stage} />
            <Stat label="Goal" value={board.weekGoal} />
            <Stat
              label="Spend"
              value={`$${board.cost.spentUsd.toFixed(2)}`}
            />
            <Stat
              label="Budget"
              value={
                board.cost.budgetUsd === null
                  ? "Not set"
                  : `$${board.cost.budgetUsd.toFixed(2)}`
              }
            />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[1fr_0.9fr]">
        <BoardSection title="Progress" items={board.progress} />
        <BoardSection title="Today" items={board.todayTasks} />
        <BoardSection title="App Diagnosis" items={board.diagnosis} />
        <section>
          <SectionTitle>Pending Approvals</SectionTitle>
          {board.pendingApprovals.length === 0 ? (
            <EmptyPanel text="No drafts are waiting on the user right now." />
          ) : (
            <div className="space-y-3">
              {board.pendingApprovals.map((draft) => (
                <article
                  key={draft.id}
                  className="border border-paper-faint/15 bg-ink-2 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="font-mono text-xs uppercase tracking-widest text-lime">
                      {draft.platform}
                    </p>
                    <p className="text-xs text-paper-faint">
                      {draft.evidenceCount} evidence refs
                    </p>
                  </div>
                  <p className="text-sm leading-relaxed text-paper-dim">
                    {draft.body}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mx-auto grid max-w-6xl gap-8 px-5 pb-12 sm:px-8 lg:grid-cols-[1.1fr_0.8fr]">
        <section>
          <SectionTitle>Channel Decisions</SectionTitle>
          {board.channelDecisions.length === 0 ? (
            <EmptyPanel text="Maya has not selected primary or secondary channels yet." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {board.channelDecisions.map((channel) => (
                <article
                  key={channel.channel}
                  className="border border-paper-faint/15 bg-ink-2 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-2xl capitalize">
                        {channel.channel}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-widest text-paper-faint">
                        {channel.decision} / {channel.confidence}
                      </p>
                    </div>
                    <StatusPill state={channel.decision === "blocked" ? "blocked" : "done"} />
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-paper-dim">
                    {channel.firstWeekTest ?? "No first-week test written yet."}
                  </p>
                  <ListBlock title="Reasons" items={channel.reasons} />
                  <ListBlock title="Risks" items={channel.risks} />
                </article>
              ))}
            </div>
          )}
        </section>
        <BoardSection title="Results" items={board.results} />
      </div>

      <section className="border-t border-paper-faint/15 px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <SectionTitle>Evidence Cards</SectionTitle>
          {board.evidenceCards.length === 0 ? (
            <EmptyPanel text="No cited evidence has been stored yet." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {board.evidenceCards.map((card) => (
                <a
                  key={`${card.source}:${card.url}`}
                  href={card.url}
                  className="border border-paper-faint/15 bg-ink-2 p-4 hover:border-paper-faint/50"
                >
                  <p className="font-mono text-xs uppercase tracking-widest text-lime">
                    {card.source} / {card.use}
                  </p>
                  <h2 className="mt-3 line-clamp-2 font-display text-xl">
                    {card.title}
                  </h2>
                  <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-paper-dim">
                    {card.snippet}
                  </p>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function MissionBoardSkeleton() {
  return (
    <main
      data-testid="gtm-mission-board-skeleton"
      className="min-h-screen bg-ink px-5 py-10 text-paper sm:px-8"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="h-16 w-2/3 animate-pulse bg-ink-3" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse bg-ink-3" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-36 animate-pulse bg-ink-3" />
          ))}
        </div>
      </div>
    </main>
  );
}

function MissionBoardEmpty() {
  return (
    <main className="min-h-screen bg-ink px-5 py-12 text-paper sm:px-8">
      <div className="mx-auto max-w-3xl border border-paper-faint/15 bg-ink-2 p-8">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-lime">
          ClawLaunch
        </p>
        <h1 className="mt-4 font-display text-4xl">Finish onboarding</h1>
        <p className="mt-4 text-sm leading-relaxed text-paper-dim">
          The Mission Board unlocks after Maya has a GTM account, app profile,
          and first research job to read from.
        </p>
        <Link
          href="/onboarding/gtm"
          className="mt-6 inline-flex rounded-full bg-paper px-5 py-3 text-sm font-medium text-ink hover:bg-white"
        >
          Continue onboarding
        </Link>
      </div>
    </main>
  );
}

function BoardSection({
  title,
  items,
}: {
  title: string;
  items: MissionBoardItem[];
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-3">
        {items.map((item) => (
          <article
            key={`${item.label}:${item.detail}`}
            className="flex gap-4 border border-paper-faint/15 bg-ink-2 p-4"
          >
            <StatusPill state={item.state} />
            <div>
              <h2 className="font-medium text-paper">{item.label}</h2>
              <p className="mt-1 text-sm leading-relaxed text-paper-dim">
                {item.detail}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
      {children}
    </h2>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-paper-faint/15 bg-ink-2 p-4">
      <p className="font-mono text-[0.65rem] uppercase tracking-widest text-paper-faint">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-medium text-paper">{value}</p>
    </div>
  );
}

function StatusPill({ state }: { state: MissionBoardItem["state"] }) {
  const label = state.replace("_", " ");
  const className =
    state === "done"
      ? "border-lime/60 text-lime"
      : state === "active"
        ? "border-paper-dim/60 text-paper"
        : state === "blocked"
          ? "border-rose/60 text-rose"
          : "border-paper-faint/40 text-paper-faint";
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-widest ${className}`}
    >
      {label}
    </span>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="border border-paper-faint/15 bg-ink-2 p-5 text-sm text-paper-dim">
      {text}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="mb-2 font-mono text-[0.65rem] uppercase tracking-widest text-paper-faint">
        {title}
      </p>
      <ul className="space-y-1 text-sm leading-relaxed text-paper-dim">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
