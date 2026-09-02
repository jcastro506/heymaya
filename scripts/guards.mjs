// Build guards that are cheaper as greps than as tests. Run by `npm run guards` in CI.
// Each guard names the rule it enforces and where the rule lives in the plan.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const failures = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".convex", "coverage"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(root);
const rel = (p) => relative(root, p);

// 1. Marketing and product copy: no "AI", no "UGC", no vendor names (plan §7, S1).
const copyFiles = files.filter((p) => /\/(app|components|content)\/.*\.(tsx|ts|md|mdx)$/.test(p) && !/\.test\./.test(p) && !/\/providers\.tsx$/.test(p) && !/\/app\/api\//.test(p)); // providers and API routes are wiring, not copy
const forbidden = [/\bAI\b/, /\bUGC\b/, /ScrapeCreators/i, /Zernio/i, /OpenRouter/i, /Gemini/i, /Convex/i];
for (const p of copyFiles) {
  // Copy is what a user could see: drop import lines and comments before matching,
  // otherwise `from "convex/react"` counts as a vendor name in the UI.
  const src = readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => !/^\s*import\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  for (const re of forbidden) {
    if (/\/app\/(ops|privacy|terms)\//.test(p)) continue; // the operator console and the legal pages must name vendors
    const m = src.match(re);
    if (m) failures.push(`copy: ${rel(p)} contains ${JSON.stringify(m[0])} (§7 copy rules)`);
  }
}

// 2. Stray files: iCloud duplicate names (" 2.", " 3.") that the legacy repo shipped by accident.
for (const p of files) if (/ \d\.[a-z]+$/.test(p)) failures.push(`stray: ${rel(p)} looks like an iCloud duplicate`);

// 3. Deploy guard present and the bare command not referenced in scripts (plan §20.3).
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  if (/\bconvex deploy\b/.test(cmd) && !cmd.includes("convex-deploy")) failures.push(`scripts.${name} runs bare 'convex deploy' (§20.3)`);
}

// 4. Chat-completeness registry (plan §1, §11.3): every UI control declares its chat equivalent.
try {
  const reg = JSON.parse(readFileSync(join(root, "lib/ui/controls.json"), "utf8"));
  for (const c of reg.controls ?? []) if (!c.chatTool) failures.push(`chat-completeness: control ${c.id} has no chatTool`);
} catch {
  /* registry arrives with S4; absence is not a failure before then */
}

// 5. Scar-tissue list: every numbered item in docs/SALVAGE_MANIFEST.md has a guard reference.
try {
  const manifest = readFileSync(join(root, "docs/SALVAGE_MANIFEST.md"), "utf8");
  const items = manifest.match(/^\| *\d+ *\|.*$/gm) ?? [];
  for (const line of items) {
    const cells = line.split("|").map((s) => s.trim());
    const guard = cells[cells.length - 2] ?? "";
    if (/no guard|TODO|\?\?/.test(guard)) failures.push(`scar-tissue: item ${cells[1]} has no guard yet`);
  }
} catch {
  /* manifest arrives in Sprint 0 */
}

if (failures.length) {
  console.error(`guards: ${failures.length} failure(s)\n` + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("guards: ok");
