// Copies the research pipeline's outputs that the terminal reads into terminal/data, so a deployed
// build (whose root is this folder) has them. Run after re-running the pipeline:  pnpm sync-data
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "research", "data");
const dst = path.resolve(here, "..", "data");

if (!existsSync(src)) {
  console.error(`No research data at ${src}. Run the pipeline first (see README).`);
  process.exit(1);
}
mkdirSync(path.join(dst, "feeds"), { recursive: true });
let n = 0;
for (const f of ["jumps.csv", "ledger.csv", "ledger_summary.json"]) {
  cpSync(path.join(src, f), path.join(dst, f));
  n++;
}
for (const f of readdirSync(path.join(src, "feeds")).filter((x) => x.endsWith(".csv"))) {
  cpSync(path.join(src, "feeds", f), path.join(dst, "feeds", f));
  n++;
}
console.log(`synced ${n} files → ${dst}`);
