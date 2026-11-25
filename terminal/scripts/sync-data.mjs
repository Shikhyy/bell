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
// Forward-test records (predictions, results, summary) live at the repo root, outside research/data.
const fwdSrc = path.resolve(here, "..", "..", "forward");
if (existsSync(fwdSrc)) {
  for (const d of ["predictions", "results"]) {
    mkdirSync(path.join(dst, "forward", d), { recursive: true });
    for (const f of existsSync(path.join(fwdSrc, d)) ? readdirSync(path.join(fwdSrc, d)).filter((x) => x.endsWith(".json")) : []) {
      cpSync(path.join(fwdSrc, d, f), path.join(dst, "forward", d, f));
      n++;
    }
  }
  if (existsSync(path.join(fwdSrc, "summary.json"))) {
    cpSync(path.join(fwdSrc, "summary.json"), path.join(dst, "forward", "summary.json"));
    n++;
  }
}
console.log(`synced ${n} files → ${dst}`);
