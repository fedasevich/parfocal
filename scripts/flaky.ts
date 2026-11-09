import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const quarantineTag = "@quarantine";
export const maxQuarantineDays = 30;

export interface QuarantineEntry {
  readonly file: string;
  readonly title: string;
  readonly issue: string;
  readonly expires: string;
  readonly reason: string;
}

export interface QuarantineFile {
  readonly rule: string;
  readonly quarantined: readonly QuarantineEntry[];
}

export interface FlakyTest {
  readonly file: string;
  readonly title: string;
  readonly project: string;
  readonly failedAttempts: number;
  readonly source: string;
}

export const quarantineUrl = new URL("../flaky-quarantine.json", import.meta.url);
export const repoRoot = new URL("../", import.meta.url);

export function loadQuarantine(): QuarantineFile {
  return JSON.parse(readFileSync(quarantineUrl, "utf8")) as QuarantineFile;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function checkEntries(
  entries: readonly QuarantineEntry[],
  today: string,
  taggedTitles: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const label = `${entry.file} "${entry.title}"`;
    const key = `${entry.file}\u0000${entry.title}`;
    if (seen.has(key)) problems.push(`${label} is listed twice`);
    seen.add(key);
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(entry.issue)) {
      problems.push(`${label} needs a GitHub issue link`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) || Number.isNaN(Date.parse(entry.expires))) {
      problems.push(`${label} needs an expiry date as YYYY-MM-DD`);
    } else if (entry.expires < today) {
      problems.push(
        `${label} expired on ${entry.expires}, fix the test or extend it with a reason`,
      );
    } else if (daysBetween(today, entry.expires) > maxQuarantineDays) {
      problems.push(`${label} expires more than ${maxQuarantineDays} days away`);
    }
    if (entry.reason.trim() === "") problems.push(`${label} needs a reason`);
    if (!(taggedTitles.get(entry.file) ?? []).includes(entry.title)) {
      problems.push(`${label} is not tagged ${quarantineTag} in its file`);
    }
  }
  for (const [file, titles] of taggedTitles) {
    for (const title of titles) {
      if (!entries.some((entry) => entry.file === file && entry.title === title)) {
        problems.push(
          `${file} "${title}" is tagged ${quarantineTag} but has no entry in flaky-quarantine.json`,
        );
      }
    }
  }
  return problems;
}

const taggedTestPattern =
  /\btest(?:\.[a-z]+)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1\s*,\s*\{[^}]*@quarantine/g;

export function taggedTitlesIn(source: string): string[] {
  return [...source.matchAll(taggedTestPattern)].map((match) => match[2] ?? "");
}

const skippedFolders = new Set([
  "node_modules",
  "dist",
  "test-results",
  ".turbo",
  "storybook-static",
]);

export function findSpecFiles(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skippedFolders.has(name) || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...findSpecFiles(path, base));
    else if (/\.spec\.tsx?$/.test(name)) found.push(path.slice(base.length));
  }
  return found;
}

export function scanTaggedTitles(rootDir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const top of ["apps", "packages"]) {
    let children: string[];
    try {
      children = readdirSync(join(rootDir, top));
    } catch {
      continue;
    }
    for (const child of children) {
      const packageDir = join(rootDir, top, child);
      if (!statSync(packageDir).isDirectory()) continue;
      for (const spec of findSpecFiles(packageDir)) {
        const titles = taggedTitlesIn(readFileSync(join(packageDir, spec), "utf8"));
        if (titles.length > 0) result.set(`${top}/${child}${spec}`, titles);
      }
    }
  }
  return result;
}

interface JsonResult {
  readonly status?: string;
}
interface JsonTest {
  readonly projectName?: string;
  readonly status?: string;
  readonly results?: readonly JsonResult[];
}
interface JsonSpec {
  readonly title: string;
  readonly file?: string;
  readonly tests?: readonly JsonTest[];
}
interface JsonSuite {
  readonly file?: string;
  readonly specs?: readonly JsonSpec[];
  readonly suites?: readonly JsonSuite[];
}
export interface PlaywrightJson {
  readonly suites?: readonly JsonSuite[];
}

export function flakyIn(report: PlaywrightJson, source: string, packagePath: string): FlakyTest[] {
  const found: FlakyTest[] = [];
  const walk = (suite: JsonSuite, file: string): void => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "flaky") continue;
        const failed = (test.results ?? []).filter(
          (result) => result.status !== "passed" && result.status !== "skipped",
        ).length;
        found.push({
          file: `${packagePath}/${spec.file ?? here}`,
          title: spec.title,
          project: test.projectName ?? "",
          failedAttempts: failed,
          source,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites ?? []) walk(suite, "");
  return found;
}

export function renderReport(
  entries: readonly QuarantineEntry[],
  flaky: readonly FlakyTest[],
  today: string,
  windowDays: number,
): string {
  const lines = [`## Flaky test report for ${today}`, ""];
  lines.push(`### Quarantined tests (${entries.length})`, "");
  if (entries.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Test | Issue | Expires | Days left |", "| --- | --- | --- | ---: |");
    for (const entry of entries) {
      const left = daysBetween(today, entry.expires);
      const flag = left < 0 ? "EXPIRED" : String(left);
      lines.push(
        `| ${entry.file} "${entry.title}" | ${entry.issue} | ${entry.expires} | ${flag} |`,
      );
    }
  }
  lines.push(
    "",
    `### Tests that failed and then passed on retry in the last ${windowDays} days`,
    "",
  );
  const grouped = new Map<string, FlakyTest[]>();
  for (const test of flaky) {
    const key = `${test.file}\u0000${test.title}`;
    grouped.set(key, [...(grouped.get(key) ?? []), test]);
  }
  if (grouped.size === 0) {
    lines.push("None.");
  } else {
    lines.push("| Test | Times flaky | Seen in |", "| --- | ---: | --- |");
    const rows = [...grouped.values()].sort((a, b) => b.length - a.length);
    for (const tests of rows) {
      const first = tests[0];
      if (first === undefined) continue;
      const quarantined = entries.some((e) => e.file === first.file && e.title === first.title);
      const sources = [...new Set(tests.map((t) => t.source))].join(", ");
      lines.push(
        `| ${first.file} "${first.title}"${quarantined ? " (quarantined)" : ""} | ${tests.length} | ${sources} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function readReports(dir: string): FlakyTest[] {
  const found: FlakyTest[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "flaky.json") {
        found.push(...(JSON.parse(readFileSync(path, "utf8")) as FlakyTest[]));
      }
    }
  };
  walk(dir);
  return found;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

if (import.meta.main) {
  const [command, arg, windowArg] = process.argv.slice(2);
  const root = new URL(".", repoRoot).pathname;
  if (command === "check") {
    const problems = checkEntries(loadQuarantine().quarantined, today(), scanTaggedTitles(root));
    for (const problem of problems) console.error(problem);
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (command === "report" && arg !== undefined) {
    process.stdout.write(
      renderReport(loadQuarantine().quarantined, readReports(arg), today(), Number(windowArg ?? 7)),
    );
  } else if (command === "extract" && arg !== undefined) {
    const [, , , , sourceName = "", packagePath = ""] = process.argv;
    const report = JSON.parse(readFileSync(arg, "utf8")) as PlaywrightJson;
    process.stdout.write(JSON.stringify(flakyIn(report, sourceName, packagePath)));
  } else if (command === "summary" && arg !== undefined) {
    const found = JSON.parse(readFileSync(arg, "utf8")) as FlakyTest[];
    if (found.length > 0) {
      const lines = ["### Tests that failed and then passed on retry", ""];
      for (const test of found)
        lines.push(
          `- ${test.file} "${test.title}" failed ${test.failedAttempts} time(s) before passing`,
        );
      process.stdout.write(`${lines.join("\n")}\n`);
    }
  } else {
    console.error(
      "usage: flaky.ts check | report DIR [DAYS] | extract REPORT SOURCE PACKAGE_PATH | summary FLAKY_JSON",
    );
    process.exit(2);
  }
}
