// convex-test needs the module map of every Convex function file (including _generated).
// Negative patterns keep test files and this file out of the map.
type ViteImportMeta = ImportMeta & { glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>> };
export const modules = (import.meta as ViteImportMeta).glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./test.setup.ts"]);
