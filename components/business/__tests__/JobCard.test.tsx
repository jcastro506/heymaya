/**
 * JobCard render tests — loading / populated / clickable variants.
 *
 * Pure server-side render via react-dom/server (mirrors creator-side
 * `Sparkline.test.ts` pattern; no jsdom).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { JobCard, type JobCardProps } from "../JobCard";

const baseJob: JobCardProps["job"] = {
  _id: "job-1" as JobCardProps["job"]["_id"],
  status: "scheduled",
  scheduledAt: 1_700_000_000_000,
  technicianName: "Mike",
  serviceType: "Drain clear",
  ticketAmountUsd: 425,
};

describe("JobCard", () => {
  it("renders the populated state with all fields", () => {
    const html = renderToStaticMarkup(
      createElement(JobCard, {
        job: baseJob,
        customerName: "Sarah Chen",
      })
    );
    expect(html).toContain("Drain clear");
    expect(html).toContain("Mike");
    expect(html).toContain("Sarah Chen");
    expect(html).toContain("$425");
    expect(html).toContain("biz-job-card");
  });

  it("renders without optional fields (minimal job)", () => {
    const html = renderToStaticMarkup(
      createElement(JobCard, {
        job: {
          _id: "job-2" as JobCardProps["job"]["_id"],
          status: "in-progress",
          photos: [],
        } as unknown as JobCardProps["job"],
      })
    );
    expect(html).toContain("Service call");
    expect(html).toContain("In progress");
    expect(html).toContain("Unscheduled");
  });

  it("renders status badge with correct label per status", () => {
    for (const status of ["scheduled", "in-progress", "completed", "cancelled"] as const) {
      const html = renderToStaticMarkup(
        createElement(JobCard, {
          job: { ...baseJob, status },
        })
      );
      expect(html.toLowerCase()).toContain(
        status === "in-progress"
          ? "in progress"
          : status === "completed"
          ? "completed"
          : status === "cancelled"
          ? "cancelled"
          : "scheduled"
      );
    }
  });

  it("renders as a button when onClick is provided", () => {
    const html = renderToStaticMarkup(
      createElement(JobCard, {
        job: baseJob,
        onClick: () => {},
      })
    );
    expect(html).toMatch(/<button/);
  });

  it("renders as a div when no onClick", () => {
    const html = renderToStaticMarkup(
      createElement(JobCard, { job: baseJob })
    );
    expect(html).toMatch(/<div/);
    expect(html).not.toMatch(/<button/);
  });
});
