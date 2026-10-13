import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The same "@/" alias as tsconfig, so tests can render the website's pages.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    setupFiles: ["tests/_clock.setup.ts"],
    include: ["convex/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text-summary"] },
  },
});
