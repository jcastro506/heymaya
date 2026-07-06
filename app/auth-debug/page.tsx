"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

type Health =
  | { status: "idle" | "running" }
  | {
      status: "done";
      clerk: {
        isLoaded: boolean;
        isSignedIn: boolean | undefined;
        userId: string | null | undefined;
        sessionId: string | null | undefined;
      };
      token: {
        present: boolean;
        jwtParts: number | null;
        issuer: string | null;
        audience: unknown;
        subject: string | null;
        expiresAt: number | null;
      };
      convex: {
        ok: boolean;
        snapshot: "null" | "present" | "not-run";
        error: string | null;
      };
    }
  | { status: "error"; error: string };

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

export default function AuthDebugPage() {
  const { isLoaded, isSignedIn, getToken, userId, sessionId } = useAuth();
  const [health, setHealth] = useState<Health>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setHealth({ status: "running" });
      try {
        const token = await getToken({ template: "convex" });
        const claims = token ? decodeJwtPayload(token) : {};
        const next: Health = {
          status: "done",
          clerk: { isLoaded, isSignedIn, userId, sessionId },
          token: {
            present: Boolean(token),
            jwtParts: token ? token.split(".").length : null,
            issuer: typeof claims.iss === "string" ? claims.iss : null,
            audience: claims.aud ?? null,
            subject: typeof claims.sub === "string" ? claims.sub : null,
            expiresAt: typeof claims.exp === "number" ? claims.exp : null,
          },
          convex: { ok: false, snapshot: "not-run", error: null },
        };
        if (token) {
          try {
            const client = new ConvexHttpClient(
              process.env.NEXT_PUBLIC_CONVEX_URL!
            );
            client.setAuth(token);
            const snapshot = await client.query(
              api.gtmMaya.researchLifecycle.getMyGtmSnapshot,
              {}
            );
            next.convex = {
              ok: true,
              snapshot: snapshot ? "present" : "null",
              error: null,
            };
          } catch (err) {
            next.convex = {
              ok: false,
              snapshot: "not-run",
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        if (!cancelled) setHealth(next);
      } catch (err) {
        if (!cancelled) {
          setHealth({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, sessionId, userId]);

  return (
    <main className="min-h-screen bg-ink p-8 text-paper">
      <h1 className="mb-4 font-display text-3xl">Auth debug</h1>
      <pre className="overflow-auto rounded border border-paper/20 bg-ink-2 p-4 text-xs">
        {JSON.stringify(health, null, 2)}
      </pre>
    </main>
  );
}
