import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror Next.js's "@/*" → "./*" path alias from tsconfig.json so
      // component imports (`@/convex/_generated/api`) resolve under vitest
      // without hand-rolling relative paths.
      "@": resolve(ROOT, "."),
    },
  },
  test: {
    // convex-test requires the edge-runtime VM to emulate the Convex JS runtime.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: [
      "convex/**/__tests__/**/*.test.ts",
      "convex/**/*.test.ts",
      "lib/**/*.test.ts",
      "components/**/__tests__/**/*.test.{ts,tsx}",
      "tests/**/*.test.ts",
      "agents/**/__tests__/**/*.test.ts",
    ],
  },
});
