import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isTrendReport, type TrendReport, trendMarkdown } from "../src/memory/heap-trend.ts";

function readReports(dir: string): TrendReport[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".trend.json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown)
    .filter(isTrendReport);
}

const reports = process.argv.slice(2).flatMap(readReports);
process.stdout.write(
  reports.length === 0
    ? "## Memory and leak suite\n\nNo trend reports were written.\n"
    : trendMarkdown(reports),
);
