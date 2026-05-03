// Shared module map for convex-test.
//
// Why this lives at tests/_modules.ts (not under convex/):
// (a) `import.meta.glob` is a vite-only directive that Convex's deployment
//     analyzer cannot parse, so any file containing it under convex/ breaks
//     `npx convex dev`/`deploy`. Even a leading-underscore directory like
//     convex/_test/ gets analyzed if reached transitively.
// (b) vite's glob normalizes resulting keys to the SHORTEST relative path
//     from the calling file. From a deeply-nested test, an inline glob
//     produces inconsistent prefixes that break convex-test's
//     findModulesRoot. A single fixed location avoids that.
//
// `import.meta.glob` is a Vite extension to `ImportMeta`. The project root
// `tsconfig.json` does not load `vite/client` types globally (no Convex /
// Next.js code needs them), so we narrow `import.meta` locally to expose
// only the `glob` member used here. This keeps the runtime behavior intact
// while satisfying tsc under both the root and Convex tsconfigs without
// poisoning the global types.
type ViteImportMeta = ImportMeta & {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
};

export const modules = (import.meta as ViteImportMeta).glob(
  "../convex/**/*.{ts,js}"
);
