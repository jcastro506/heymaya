/**
 * Week-grid post calendar for the Posts → Calendar tab.
 *
 * Renders the next 7 days × platform rows (GBP / FB / IG). Each cell shows:
 *   - Drafted post (status === "pending")          → amber dot
 *   - Posted post (status === "posted")            → lime dot
 *   - Rejected post                                → muted dot
 *
 * Pure render — no chart lib. Posts are bucketed by `scheduledAt` (or
 * `postedAt` for already-published) and the rows render a small dot per
 * post in the matching slot. Click handler optional — Sprint 5 wires
 * detail view.
 */

import type { Doc } from "@/convex/_generated/dataModel";
import { useMemo } from "react";

export interface PostCalendarProps {
  posts: Doc<"gbpPosts">[];
  /** Optional: callback when a cell is clicked. */
  onSelectDay?: (dayKey: string) => void;
  testId?: string;
}

const PLATFORMS = [{ key: "gbp", label: "Google Business Profile" }] as const;

export function PostCalendar({
  posts,
  onSelectDay,
  testId,
}: PostCalendarProps) {
  const days = useMemo(() => {
    const out: { key: string; label: string; ms: number }[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      out.push({
        key: ymd(d),
        label: d.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
        }),
        ms: d.getTime(),
      });
    }
    return out;
  }, []);

  return (
    <div
      data-testid={testId ?? "biz-post-calendar"}
      className="overflow-x-auto rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-3"
    >
      <table className="w-full min-w-[600px] border-collapse">
        <thead>
          <tr>
            <th className="w-44 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-paper-faint">
              Platform
            </th>
            {days.map((d) => (
              <th
                key={d.key}
                className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-paper-faint"
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLATFORMS.map((p) => (
            <tr key={p.key} className="border-t border-[var(--hairline)]">
              <td className="px-3 py-3 text-sm text-paper-dim">{p.label}</td>
              {days.map((d) => {
                const dayPosts = posts.filter((post) => {
                  const ms = post.scheduledAt ?? post.postedAt ?? post._creationTime;
                  return ymd(new Date(ms)) === d.key;
                });
                return (
                  <td
                    key={d.key}
                    className="px-2 py-3 align-top"
                    onClick={() => onSelectDay?.(d.key)}
                  >
                    {dayPosts.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {dayPosts.map((post) => (
                          <span
                            key={post._id}
                            data-testid={`biz-post-cell-${post.status}`}
                            title={post.text.slice(0, 80)}
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              post.status === "posted"
                                ? "bg-lime"
                                : post.status === "pending"
                                ? "bg-amber-300"
                                : post.status === "rejected"
                                ? "bg-rose-300"
                                : "bg-paper-faint"
                            }`}
                          />
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-paper-faint">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
