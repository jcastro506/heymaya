/**
 * ⭐ SVG → PNG — the step that makes a slide postable (§7.5.1, Sprint 7).
 *
 * Our layouts emit SVG on purpose: §7.5.1 requires headlines be *"composited as
 * real text in the brand font, never generated as pixels."* Platforms want
 * pixels, Convex has no renderer, so the flattening lives in the Next app we
 * already deploy.
 *
 * ⚠️ This is the load-bearing step for the CHEAP path. Title, point and CTA
 * slides never touch an image model — for those, this route is the only
 * processing that happens, and it is what makes a daily TikTok placement cost
 * approximately nothing.
 */
import { describe, expect, it, beforeAll } from "vitest";

const SECRET = "test-secret";
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="#0a0a0a"/><text x="72" y="500" font-family="Geist" font-size="84" fill="#fbfaf6">Nobody knows it exists</text></svg>`;

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.RENDER_SHARED_SECRET = SECRET;
  ({ POST } = await import("../route"));
});

function req(body: unknown, auth = `Bearer ${SECRET}`): Request {
  return new Request("http://test/api/render/slide", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function png(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe("it produces a real image", () => {
  it("returns a PNG at the requested width", async () => {
    const res = await POST(req({ svg: SVG }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const buf = await png(res);
    // Magic bytes, not just a content-type header we set ourselves.
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBe(1920);
  });

  it("⚠️ survives a SECOND request on the same warm instance", async () => {
    // `initWasm` throws if called twice, so a naive per-request init works
    // exactly once and then 500s for the life of the instance — a bug that
    // passes every local test and fails on the second real request.
    for (let i = 0; i < 3; i += 1) {
      expect((await POST(req({ svg: SVG }))).status, `request ${i + 1}`).toBe(200);
    }
  });
});

describe("⭐ it says whether these are really their fonts", () => {
  it("reports zero when none were supplied", async () => {
    // The measured trap: with no font file, Geist and sans-serif render
    // byte-identically and nothing errors. The count is how a caller tells
    // "rendered in your fonts" from "rendered in something".
    const res = await POST(req({ svg: SVG }));
    expect(res.headers.get("x-fonts-embedded")).toBe("0");
  });

  it("a font that fails to fetch is skipped, not fatal", async () => {
    // Five of six faces still beats a generic render.
    const res = await POST(
      req({ svg: SVG, fontUrls: ["https://127.0.0.1:1/nope.woff2"] })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fonts-embedded")).toBe("0");
  });
});

describe("what it refuses", () => {
  it("rendering arbitrary SVG is not open to the internet", async () => {
    // An SVG can reference remote URLs, so this endpoint fetches whatever it
    // is handed. It is authenticated for that reason.
    expect((await POST(req({ svg: SVG }, "Bearer wrong"))).status).toBe(401);
    expect((await POST(req({ svg: SVG }, ""))).status).toBe(401);
  });

  it("refuses anything that isn't an svg", async () => {
    for (const svg of ["hello", "<html></html>", "", "<script>alert(1)</script>"]) {
      expect((await POST(req({ svg }))).status, svg.slice(0, 12)).toBe(400);
    }
  });

  it("refuses a body that isn't JSON", async () => {
    const res = await POST(
      new Request("http://test/api/render/slide", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });
});
