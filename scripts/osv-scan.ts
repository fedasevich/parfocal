import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const allowlistPath = "osv-scanner.toml";
export const lockfiles = ["pnpm-lock.yaml", "uv.lock"];
export const knownVulnerableFixture =
  "requirements.txt:scripts/fixtures/security/known-vulnerable.requirements";
export const knownVulnerableAdvisory = "GHSA-462w-v97r-4m45";
export const maxAllowlistDays = 90;

const FINDINGS_EXIT_CODE = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AllowlistEntry {
  id: string;
  ignoreUntil: string;
  reason: string;
}

export function parseAllowlist(text: string): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  let current: Partial<AllowlistEntry> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "[[IgnoredVulns]]") {
      current = {};
      entries.push(current as AllowlistEntry);
      continue;
    }
    const match = /^(id|ignoreUntil|reason)\s*=\s*(.+)$/.exec(line);
    if (current && match) {
      const [, key, value] = match as unknown as [string, keyof AllowlistEntry, string];
      current[key] = value.replace(/^"(.*)"$/, "$1");
    }
  }
  return entries;
}

export function allowlistProblems(entries: AllowlistEntry[], today: Date): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const label = entry.id ?? "an entry without an id";
    if (!entry.id) problems.push("an allowlist entry has no id");
    if (entry.id && seen.has(entry.id)) problems.push(`${entry.id} is listed twice`);
    seen.add(entry.id);
    if (!entry.reason) problems.push(`${label} has no reason`);
    const until = Date.parse(entry.ignoreUntil ?? "");
    if (Number.isNaN(until)) {
      problems.push(`${label} has no ignoreUntil date`);
      continue;
    }
    if (until <= today.getTime())
      problems.push(
        `${label} expired on ${entry.ignoreUntil}, upgrade the package or renew with a new reason`,
      );
    if (until - today.getTime() > maxAllowlistDays * DAY_MS)
      problems.push(`${label} is allowed for more than ${maxAllowlistDays} days`);
  }
  return problems;
}

export function selfTestProblem(exitCode: number | null, jsonText: string): string | null {
  if (exitCode !== FINDINGS_EXIT_CODE)
    return `osv-scanner exited with ${exitCode} on the known vulnerable fixture, expected ${FINDINGS_EXIT_CODE}`;
  if (!jsonText.includes(`"${knownVulnerableAdvisory}"`))
    return `osv-scanner did not report ${knownVulnerableAdvisory} for the known vulnerable fixture`;
  return null;
}

export function osvScannerAvailable(): boolean {
  return spawnSync("osv-scanner", ["--version"], { stdio: "ignore" }).status === 0;
}

export function scanLockfiles(): number {
  const args = [
    "scan",
    "source",
    `--config=${allowlistPath}`,
    ...lockfiles.map((file) => `--lockfile=${file}`),
  ];
  return spawnSync("osv-scanner", args, { cwd: repoRoot, stdio: "inherit" }).status ?? 2;
}

export function scanKnownVulnerableFixture(): string | null {
  const result = spawnSync(
    "osv-scanner",
    ["scan", "source", "--format=json", `--lockfile=${knownVulnerableFixture}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return selfTestProblem(result.status, result.stdout ?? "");
}

if (import.meta.main) {
  const command = process.argv[2] ?? "scan";
  if (command === "allowlist") {
    const problems = allowlistProblems(
      parseAllowlist(readFileSync(new URL(`../${allowlistPath}`, import.meta.url), "utf8")),
      new Date(),
    );
    for (const problem of problems) console.error(problem);
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (command === "self-test") {
    const problem = scanKnownVulnerableFixture();
    console.log(
      problem ??
        `osv-scanner reported ${knownVulnerableAdvisory} and failed on the known vulnerable fixture, as it should`,
    );
    process.exit(problem === null ? 0 : 1);
  } else if (command === "scan") {
    process.exit(scanLockfiles());
  } else {
    console.error("Usage: node scripts/osv-scan.ts [scan|self-test|allowlist]");
    process.exit(2);
  }
}
