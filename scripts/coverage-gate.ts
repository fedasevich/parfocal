import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const reportFile = "coverage.lcov";
export const workspaceGroups = ["apps", "packages", "workers"] as const;

export interface CoverageTotals {
  readonly found: number;
  readonly hit: number;
}

export interface WorkspacePackage {
  readonly dir: string;
  readonly name: string;
  readonly testScript: string | undefined;
  readonly minLines: number | undefined;
}

export interface GateRow {
  readonly dir: string;
  readonly name: string;
  readonly minLines: number;
  readonly lines: number | undefined;
  readonly passed: boolean;
}

interface PackageJson {
  readonly name?: string;
  readonly scripts?: Record<string, string>;
  readonly coverage?: { readonly lines?: number };
}

export function parseLcov(text: string): CoverageTotals {
  let found = 0;
  let hit = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("LF:")) found += Number(line.slice(3));
    else if (line.startsWith("LH:")) hit += Number(line.slice(3));
  }
  return { found, hit };
}

export function linePercent(totals: CoverageTotals): number {
  return totals.found === 0 ? 100 : (totals.hit / totals.found) * 100;
}

export function workspacePackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of workspaceGroups) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(groupDir, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, "utf8")) as PackageJson;
      found.push({
        dir: `${group}/${entry.name}`,
        name: json.name ?? entry.name,
        testScript: json.scripts?.test,
        minLines: json.coverage?.lines,
      });
    }
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

export function setupProblems(packages: readonly WorkspacePackage[]): string[] {
  const problems: string[] = [];
  for (const pkg of packages) {
    if (pkg.testScript === undefined) continue;
    if (!pkg.testScript.includes(reportFile)) {
      problems.push(`${pkg.dir} test script must write ${reportFile}`);
    }
    if (
      typeof pkg.minLines !== "number" ||
      !Number.isFinite(pkg.minLines) ||
      pkg.minLines < 0 ||
      pkg.minLines > 100
    ) {
      problems.push(`${pkg.dir} package.json needs coverage.lines between 0 and 100`);
    }
  }
  return problems;
}

export function gate(root: string, packages: readonly WorkspacePackage[]): GateRow[] {
  const rows: GateRow[] = [];
  for (const pkg of packages) {
    if (pkg.testScript === undefined || pkg.minLines === undefined) continue;
    const report = join(root, pkg.dir, reportFile);
    const lines = existsSync(report)
      ? linePercent(parseLcov(readFileSync(report, "utf8")))
      : undefined;
    rows.push({
      dir: pkg.dir,
      name: pkg.name,
      minLines: pkg.minLines,
      lines,
      passed: lines !== undefined && lines >= pkg.minLines,
    });
  }
  return rows;
}

export function renderTable(rows: readonly GateRow[]): string {
  const out = ["| Package | Lines | Minimum | Result |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    const lines = row.lines === undefined ? "no report" : `${row.lines.toFixed(2)}%`;
    out.push(`| ${row.name} | ${lines} | ${row.minLines}% | ${row.passed ? "pass" : "FAIL"} |`);
  }
  return out.join("\n");
}

function main(): void {
  const root = new URL("../", import.meta.url).pathname;
  const packages = workspacePackages(root);
  const problems = setupProblems(packages);
  const rows = gate(root, packages);
  const table = renderTable(rows);
  console.log(table);
  const summary = process.argv[2];
  if (summary) appendFileSync(summary, `## Unit test line coverage\n\n${table}\n`);
  for (const problem of problems) console.error(problem);
  const failed = rows.filter((row) => !row.passed);
  for (const row of failed) {
    console.error(
      row.lines === undefined
        ? `${row.dir} wrote no ${reportFile}, run its tests first`
        : `${row.dir} line coverage ${row.lines.toFixed(2)}% is under its minimum ${row.minLines}%`,
    );
  }
  if (problems.length > 0 || failed.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
