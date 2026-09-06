import { describe, expect, it } from "vitest";
import { clusterPosts, groupWords, lanesFrom, CLUSTERS, type ClusterIn } from "../clusters";

const STOP = new Set(["this", "that", "with"]);
const v = (x: number, y: number) => { const n = Math.hypot(x, y); return [x / n, y / n]; };
const post = (id: string, text: string, vector: number[] | null, multiple: number | null, hashtags: string[] = []): ClusterIn => ({ postId: id, text, vector, multiple, hashtags });

describe("grouping their posts (Sprint 4f)", () => {
  it("groups by cosine and drops singletons: a single post is a post, not a direction", () => {
    const posts = [
      post("r1", "morning run in london", v(1, 0.05), 1.4, ["running"]),
      post("r2", "long run sunday pace", v(1, 0.1), 1.9, ["running"]),
      post("r3", "tempo run hurt", null, 1.2, ["running"]),
      post("t1", "piccadilly at night", v(0, 1), 0.6, ["travel"]),
      post("t2", "brisbane first day", v(0.05, 1), 0.7, ["travel"]),
      post("f1", "my csv dashboard demo", v(0.7, 0.7), 0.3, ["buildinpublic"]),
      post("x", "no vector", null, 1, []),
    ];
    const groups = clusterPosts(posts, 0.9);
    const lanes = lanesFrom(groups, posts.length, 1_000, STOP);
    expect(lanes.clusters.map((c) => c.postIds.length)).toEqual([2, 2]);
    expect(lanes.clusters.every((c) => c.postIds.length >= CLUSTERS.minPosts)).toBe(true);
    expect(lanes.clusters[0].medianMultiple).toBe(1.9);
    expect(lanes.clusters[0].keywords).toContain("running");
    expect(lanes.state, "two of seven is under a third of the posts: scattered").toBe("scattered");
    expect(lanes.scatter).toBeGreaterThan(0.5);
  });

  it("a catalogue where one group holds most posts is unnamed, not scattered", () => {
    const posts = [1, 2, 3, 4, 5].map((i) => post(`r${i}`, `run ${i}`, v(1, i * 0.02), 1, ["running"])).concat([post("t1", "travel", v(0, 1), 1, ["travel"]), post("t2", "travel again", v(0.02, 1), 1, ["travel"])]);
    const lanes = lanesFrom(clusterPosts(posts, 0.9), posts.length, 1_000, STOP);
    expect(lanes.state).toBe("unnamed");
    expect(lanes.clusters[0].share).toBeGreaterThan(0.6);
  });

  it("no posts is none, and a fallback name comes from the group's own words", () => {
    expect(lanesFrom([], 0, 1, STOP).state).toBe("none");
    const words = groupWords([post("a", "solo dev builds a dashboard", null, 1, ["buildinpublic", "indiehacker"]), post("b", "dashboard again", null, 1, ["buildinpublic"])], STOP);
    expect(words[0]).toBe("buildinpublic");
    expect(words).toContain("dashboard");
  });
});
