// convex-test needs the module map of every Convex function file (including _generated).
// Negative patterns keep test files and this file out of the map.
export const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./test.setup.ts"]);
