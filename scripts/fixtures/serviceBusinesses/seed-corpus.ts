/**
 * CLI: write the 50-business fixture corpus to disk as JSON.
 *
 * Usage:
 *   npx tsx scripts/fixtures/serviceBusinesses/seed-corpus.ts [seed]
 *
 * Default seed = 42 (from `DEFAULT_ROOT_SEED` in generate.ts).
 *
 * Output:
 *   scripts/fixtures/serviceBusinesses/data/<slug>.json    — full fixture
 *   scripts/fixtures/serviceBusinesses/data/<slug>/contract.md  — vendor contract
 *   scripts/fixtures/serviceBusinesses/data/_index.json    — slug → metadata
 *
 * This output is checked-in-or-excluded at the operator's discretion. The
 * tests do NOT depend on these JSON files existing — they invoke the
 * generator directly. The on-disk dump exists for human inspection.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAllBusinesses,
  DEFAULT_ROOT_SEED,
} from "./generate";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "data");

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function main() {
  const seedArg = process.argv[2];
  const rootSeed: number | string = seedArg
    ? Number.isFinite(Number(seedArg))
      ? Number(seedArg)
      : seedArg
    : DEFAULT_ROOT_SEED;

  ensureDir(OUT_DIR);
  const fixtures = generateAllBusinesses(rootSeed);
  const index: Array<{
    slug: string;
    persona: string | null;
    serviceType: string;
    sizeBracket: string;
    plan: string;
    summary: string;
  }> = [];

  for (const fx of fixtures) {
    // 1) full fixture JSON
    const jsonPath = join(OUT_DIR, `${fx.slug}.json`);
    writeFileSync(jsonPath, JSON.stringify(fx, null, 2) + "\n");

    // 2) extract the contract markdown to its own file (operator audit)
    const fxDir = join(OUT_DIR, fx.slug);
    ensureDir(fxDir);
    writeFileSync(
      join(fxDir, fx.vendorContract.filename),
      fx.vendorContract.body
    );

    index.push({
      slug: fx.slug,
      persona: fx.persona,
      serviceType: fx.serviceType,
      sizeBracket: fx.sizeBracket,
      plan: fx.plan,
      summary: fx.summary,
    });
  }

  writeFileSync(
    join(OUT_DIR, "_index.json"),
    JSON.stringify(
      {
        rootSeed,
        generatedAt: Date.now(),
        count: fixtures.length,
        fixtures: index,
      },
      null,
      2
    ) + "\n"
  );

  // eslint-disable-next-line no-console -- CLI script intentionally logs.
  console.log(
    `wrote ${fixtures.length} fixtures (seed=${rootSeed}) to ${OUT_DIR}`
  );
}

main();
