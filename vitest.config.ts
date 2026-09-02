import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text-summary"] },
  },
});
