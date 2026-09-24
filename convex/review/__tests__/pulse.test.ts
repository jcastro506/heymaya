/** The pulse is read, never asked: one word by code from what they did. */
import { describe, expect, it } from "vitest";
import { pulseWord } from "../pulse";

const w = (o: Partial<{ sent: number; replies: number; reactions: number; taken: number; passed: number; posts: number }> = {}) => ({ sent: 0, replies: 0, reactions: 0, taken: 0, passed: 0, posts: 0, ...o });
const m = (o: Partial<{ sent: number; replies: number; taken: number; posts: number }> = {}) => ({ sent: 0, replies: 0, taken: 0, posts: 0, ...o });

describe("pulseWord", () => {
  it("new for the first three days, whatever else is true", () => {
    expect(pulseWord({ week: w({ sent: 3 }), month: m({ sent: 3 }), daysSinceLastReply: null, daysSincePaired: 1 }).word).toBe("new");
  });
  it("warm when they took an idea this week", () => {
    expect(pulseWord({ week: w({ sent: 3, taken: 1 }), month: m({ sent: 6, taken: 1 }), daysSinceLastReply: 1, daysSincePaired: 20 }).word).toBe("warm");
  });
  it("cooling when she sent and nothing came back, or passes outnumber touches", () => {
    expect(pulseWord({ week: w({ sent: 3 }), month: m({ sent: 3, replies: 1 }), daysSinceLastReply: 5, daysSincePaired: 20 }).word).toBe("cooling");
    expect(pulseWord({ week: w({ sent: 3, passed: 2, replies: 1 }), month: m({ sent: 8, replies: 2 }), daysSinceLastReply: 2, daysSincePaired: 20 }).word).toBe("cooling");
  });
  it("silent after two weeks without a reply across several messages", () => {
    expect(pulseWord({ week: w({ sent: 2 }), month: m({ sent: 8, replies: 1 }), daysSinceLastReply: 15, daysSincePaired: 40 }).word).toBe("silent");
  });
  it("steady on a quiet week for both", () => {
    expect(pulseWord({ week: w({ sent: 1 }), month: m({ sent: 4, replies: 2 }), daysSinceLastReply: 4, daysSincePaired: 30 }).word).toBe("steady");
  });
});
