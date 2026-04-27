/**
 * `makePhotos` — 5 serviceContent entries per fixture pointing at stable
 * picsum.photos URLs. The seeded URL is `picsum.photos/seed/<slug>-<n>`
 * which deterministically returns the same image across runs — useful for
 * the catalog-quality test in Sprint 3.5 (§ 14 testing strategy item 10).
 */

import { JOB_TYPES, type ServiceType } from "./data";
import type { FixtureJob, FixturePhoto } from "../types";
import type { Rng } from "./rng";

interface MakePhotosInput {
  slug: string;
  serviceType: ServiceType;
  jobs: FixtureJob[];
}

export function makePhotos(rng: Rng, input: MakePhotosInput): FixturePhoto[] {
  const { slug, serviceType, jobs } = input;
  const out: FixturePhoto[] = [];
  const photoTypes = [
    "before",
    "after",
    "in-progress",
    "team-on-site",
    "completed-job",
  ];
  // Pick 5 random completed jobs (or fewer if not enough completed).
  const completed = jobs
    .map((j, idx) => ({ j, idx }))
    .filter(({ j }) => j.status === "completed");
  const pickedJobs = completed.length >= 5 ? rng.sample(completed, 5) : completed;
  for (let i = 0; i < 5; i++) {
    const photoType = photoTypes[i % photoTypes.length];
    const job = pickedJobs[i] ?? null;
    const jobType = job ? job.j.serviceType : rng.pick(JOB_TYPES[serviceType]);
    out.push({
      url: `https://picsum.photos/seed/${slug}-content-${i}/1024/768`,
      caption: `${photoType} — ${jobType}${job ? ` for the ${rng.pick(["family", "household", "client", "homeowner"])}` : ""}`,
      jobIdx: job?.idx,
      tags: [serviceType, photoType, jobType],
    });
  }
  return out;
}
