import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const allowlistPath = "osv-scanner.toml";
export const lockfiles = ["pnpm-lock.yaml", "uv.lock"];
export const knownVulnerableFixture =
  "requirements.txt:scripts/fixtures/security/known-vulnerable.requirements";
export const knownVulnerableAdvisory = "GHSA-462w-v97r-4m45";
export const iacPath = "infra/tofu";
export const misconfiguredIacFixture = "scripts/fixtures/security/misconfigured-iac";
export const misconfiguredIacCheck = "AWS-0107";
export const maxAllowlistDays = 90;

export const severities = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof severities)[number];
export const slaDays: Record<Severity, number> = { critical: 7, high: 30, medium: 90, low: 90 };

const FINDINGS_EXIT_CODE = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNRATED_SEVERITY: Severity = "high";

export interface AllowlistEntry {
  id: string;
  effectiveUntil: string;
  reason: string;
  severity: string;
}

export interface Finding {
  ids: string[];
  ecosystem: string;
  name: string;
  version: string;
  severity: Severity;
  fixed: string[];
  summary: string;
}

export interface IacFinding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
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
    const match = /^(id|effectiveUntil|ignoreUntil|reason)\s*=\s*(.+)$/.exec(line);
    if (current && match) {
      const [, key, raw] = match as unknown as [string, string, string];
      const value = raw.replace(/^"(.*)"$/, "$1");
      if (key === "id") current.id = value;
      else if (key === "reason") {
        current.reason = value;
        current.severity = /^\[(\w+)\] /.exec(value)?.[1] ?? "";
      } else current.effectiveUntil = value;
    }
  }
  return entries;
}

function isSeverity(value: string | undefined): value is Severity {
  return severities.includes(value as Severity);
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
    if (!isSeverity(entry.severity))
      problems.push(
        `${label} has no severity, start its reason with one of ${severities.map((s) => `[${s}]`).join(", ")}`,
      );
    const until = Date.parse(entry.effectiveUntil ?? "");
    if (Number.isNaN(until)) {
      problems.push(`${label} has no effectiveUntil date`);
      continue;
    }
    if (until <= today.getTime())
      problems.push(
        `${label} expired on ${entry.effectiveUntil}, upgrade the package or renew with a new reason`,
      );
    if (until - today.getTime() > maxAllowlistDays * DAY_MS)
      problems.push(`${label} is allowed for more than ${maxAllowlistDays} days`);
    if (isSeverity(entry.severity) && until - today.getTime() > slaDays[entry.severity] * DAY_MS)
      problems.push(
        `${label} is ${entry.severity} and may be allowed for at most ${slaDays[entry.severity]} days`,
      );
  }
  return problems;
}

const severityLabels: Record<string, Severity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
};

export function severityFromLabel(label: string | undefined): Severity | null {
  return severityLabels[label?.toUpperCase() ?? ""] ?? null;
}

export function severityFromScore(score: string | undefined): Severity | null {
  const value = Number.parseFloat(score ?? "");
  if (Number.isNaN(value) || value <= 0) return null;
  if (value >= 9) return "critical";
  if (value >= 7) return "high";
  if (value >= 4) return "medium";
  return "low";
}

export function worstSeverity(values: (Severity | null)[]): Severity | null {
  const known = values.filter((value): value is Severity => value !== null);
  if (known.length === 0) return null;
  return severities.find((severity) => known.includes(severity)) ?? null;
}

interface OsvVulnerability {
  id: string;
  aliases?: string[];
  summary?: string;
  database_specific?: { severity?: string };
  affected?: {
    package: { name: string };
    ranges?: { events: { fixed?: string }[] }[];
  }[];
}

interface OsvOutput {
  results?: {
    packages: {
      package: { name: string; version: string; ecosystem: string };
      groups?: { ids: string[]; aliases?: string[]; max_severity?: string }[];
      vulnerabilities: OsvVulnerability[];
    }[];
  }[];
}

export function parseOsvFindings(jsonText: string): Finding[] {
  const output = JSON.parse(jsonText) as OsvOutput;
  const findings: Finding[] = [];
  for (const result of output.results ?? []) {
    for (const { package: pkg, groups, vulnerabilities } of result.packages) {
      for (const group of groups ?? []) {
        const ids = [...new Set([...group.ids, ...(group.aliases ?? [])])];
        const members = vulnerabilities.filter((vuln) => group.ids.includes(vuln.id));
        const fixed = new Set<string>();
        for (const vuln of members)
          for (const affected of vuln.affected ?? [])
            if (affected.package.name === pkg.name)
              for (const range of affected.ranges ?? [])
                for (const event of range.events) if (event.fixed) fixed.add(event.fixed);
        findings.push({
          ids,
          ecosystem: pkg.ecosystem,
          name: pkg.name,
          version: pkg.version,
          severity:
            worstSeverity([
              ...members.map((vuln) => severityFromLabel(vuln.database_specific?.severity)),
              severityFromScore(group.max_severity),
            ]) ?? UNRATED_SEVERITY,
          fixed: [...fixed],
          summary: members.find((vuln) => vuln.summary)?.summary ?? "",
        });
      }
    }
  }
  return findings;
}

interface TrivyOutput {
  Results?: {
    Target: string;
    Misconfigurations?: { ID: string; Severity: string; Title: string; Status?: string }[];
  }[];
}

export function parseTrivyFindings(jsonText: string): IacFinding[] {
  const output = JSON.parse(jsonText) as TrivyOutput;
  return (output.Results ?? []).flatMap((result) =>
    (result.Misconfigurations ?? [])
      .filter((item) => item.Status !== "PASS")
      .map((item) => ({
        id: item.ID,
        severity: severityFromLabel(item.Severity) ?? UNRATED_SEVERITY,
        title: item.Title,
        file: result.Target,
      })),
  );
}

export function allowlistEntryFor(
  finding: Finding,
  entries: AllowlistEntry[],
): AllowlistEntry | undefined {
  return entries.find((entry) => finding.ids.includes(entry.id));
}

export function severityProblems(findings: Finding[], entries: AllowlistEntry[]): string[] {
  const problems: string[] = [];
  for (const finding of findings) {
    const entry = allowlistEntryFor(finding, entries);
    if (!entry || !isSeverity(entry.severity)) continue;
    if (severities.indexOf(finding.severity) < severities.indexOf(entry.severity))
      problems.push(
        `${entry.id} is listed as ${entry.severity} but ${finding.name} ${finding.version} rates it ${finding.severity}`,
      );
  }
  return [...new Set(problems)];
}

function daysLeft(entry: AllowlistEntry, today: Date): number {
  return Math.floor((Date.parse(entry.effectiveUntil) - today.getTime()) / DAY_MS);
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export interface ReportInput {
  today: Date;
  findings: Finding[];
  entries: AllowlistEntry[];
  iac: IacFinding[] | null;
}

export function reportProblems({ today, findings, entries, iac }: ReportInput): string[] {
  const open = findings.filter((finding) => !allowlistEntryFor(finding, entries));
  return [
    ...open.map(
      (finding) =>
        `${finding.ids[0]} (${finding.severity}) in ${finding.name} ${finding.version} is not allowlisted`,
    ),
    ...allowlistProblems(entries, today),
    ...severityProblems(findings, entries),
    ...(iac ?? []).map((item) => `${item.id} (${item.severity}) in ${item.file}: ${item.title}`),
  ];
}

export function buildReport(input: ReportInput): string {
  const { today, findings, entries, iac } = input;
  const open = findings.filter((finding) => !allowlistEntryFor(finding, entries));
  const accepted = findings.filter((finding) => allowlistEntryFor(finding, entries));
  const stale = entries.filter(
    (entry) => !findings.some((finding) => finding.ids.includes(entry.id)),
  );
  const problems = reportProblems(input);
  const lines = [
    `# Vulnerability report ${today.toISOString().slice(0, 10)}`,
    "",
    problems.length === 0
      ? "Status: clean. Every finding is fixed or allowlisted within its SLA."
      : `Status: ${problems.length} problem(s) need action.`,
    "",
    `SLA by severity: ${severities.map((severity) => `${severity} ${slaDays[severity]} days`).join(", ")}.`,
    "",
    "## Open findings",
    "",
  ];
  if (open.length === 0) lines.push("None.");
  else {
    lines.push(
      "| Advisory | Severity | Package | Fixed in | Summary |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const finding of open)
      lines.push(
        `| ${finding.ids[0]} | ${finding.severity} | ${finding.ecosystem} ${finding.name} ${finding.version} | ${finding.fixed.join(", ") || "no fix"} | ${cell(finding.summary)} |`,
      );
  }
  lines.push("", "## Allowlisted findings", "");
  if (accepted.length === 0) lines.push("None.");
  else {
    lines.push(
      "| Advisory | Severity | Package | Fixed in | Days left | Reason |",
      "| --- | --- | --- | --- | ---: | --- |",
    );
    for (const finding of accepted) {
      const entry = allowlistEntryFor(finding, entries) as AllowlistEntry;
      lines.push(
        `| ${entry.id} | ${finding.severity} | ${finding.ecosystem} ${finding.name} ${finding.version} | ${finding.fixed.join(", ") || "no fix"} | ${daysLeft(entry, today)} | ${cell(entry.reason)} |`,
      );
    }
  }
  if (stale.length > 0) {
    lines.push("", "## Allowlist entries no longer needed", "");
    for (const entry of stale) lines.push(`- ${entry.id} matches no finding and can be removed.`);
  }
  lines.push("", `## Infrastructure as code (${iacPath})`, "");
  if (iac === null) lines.push("Not scanned, trivy is not installed.");
  else if (iac.length === 0) lines.push("No misconfigurations.");
  else
    for (const item of iac)
      lines.push(`- ${item.id} (${item.severity}) in ${item.file}: ${cell(item.title)}`);
  if (problems.length > 0) {
    lines.push("", "## Problems", "");
    for (const problem of problems) lines.push(`- ${cell(problem)}`);
  }
  lines.push(
    "",
    "Container images are not scanned yet, because FOUND-015 (container images) has not built any.",
    "",
  );
  return lines.join("\n");
}

export function selfTestProblem(exitCode: number | null, jsonText: string): string | null {
  if (exitCode !== FINDINGS_EXIT_CODE)
    return `osv-scanner exited with ${exitCode} on the known vulnerable fixture, expected ${FINDINGS_EXIT_CODE}`;
  if (!jsonText.includes(`"${knownVulnerableAdvisory}"`))
    return `osv-scanner did not report ${knownVulnerableAdvisory} for the known vulnerable fixture`;
  return null;
}

export function iacSelfTestProblem(exitCode: number | null, jsonText: string): string | null {
  if (exitCode !== FINDINGS_EXIT_CODE)
    return `trivy exited with ${exitCode} on the misconfigured fixture, expected ${FINDINGS_EXIT_CODE}`;
  if (!jsonText.includes(`"${misconfiguredIacCheck}"`))
    return `trivy did not report ${misconfiguredIacCheck} for the misconfigured fixture`;
  return null;
}

function toolAvailable(command: string, versionArg: string): boolean {
  return spawnSync(command, [versionArg], { stdio: "ignore" }).status === 0;
}

export function osvScannerAvailable(): boolean {
  return toolAvailable("osv-scanner", "--version");
}

export function trivyAvailable(): boolean {
  return toolAvailable("trivy", "--version");
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

function runJson(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export function scanKnownVulnerableFixture(): string | null {
  const result = runJson("osv-scanner", [
    "scan",
    "source",
    "--format=json",
    `--lockfile=${knownVulnerableFixture}`,
  ]);
  return selfTestProblem(result.status, result.stdout ?? "");
}

function trivyConfigArgs(target: string, format: string): string[] {
  return [
    "config",
    "--quiet",
    "--exit-code",
    String(FINDINGS_EXIT_CODE),
    `--format=${format}`,
    target,
  ];
}

export function scanIac(): number {
  return (
    spawnSync("trivy", trivyConfigArgs(iacPath, "table"), { cwd: repoRoot, stdio: "inherit" })
      .status ?? 2
  );
}

export function scanMisconfiguredIacFixture(): string | null {
  const result = runJson("trivy", trivyConfigArgs(misconfiguredIacFixture, "json"));
  return iacSelfTestProblem(result.status, result.stdout ?? "");
}

export function collectFindings(): Finding[] {
  const emptyConfig = join(mkdtempSync(join(tmpdir(), "osv-")), "osv-scanner.toml");
  writeFileSync(emptyConfig, "");
  const result = runJson("osv-scanner", [
    "scan",
    "source",
    "--format=json",
    `--config=${emptyConfig}`,
    ...lockfiles.map((file) => `--lockfile=${file}`),
  ]);
  if (result.status !== 0 && result.status !== FINDINGS_EXIT_CODE)
    throw new Error(`osv-scanner exited with ${result.status}`);
  return parseOsvFindings(result.stdout);
}

export function collectIacFindings(): IacFinding[] | null {
  if (!trivyAvailable()) return null;
  const result = runJson("trivy", ["config", "--quiet", "--format=json", iacPath]);
  if (result.status !== 0) throw new Error(`trivy exited with ${result.status}`);
  return parseTrivyFindings(result.stdout);
}

function readAllowlist(): AllowlistEntry[] {
  return parseAllowlist(readFileSync(new URL(`../${allowlistPath}`, import.meta.url), "utf8"));
}

function reportSelfTest(problem: string | null, success: string): never {
  console.log(problem ?? success);
  process.exit(problem === null ? 0 : 1);
}

if (import.meta.main) {
  const command = process.argv[2] ?? "scan";
  if (command === "allowlist") {
    const problems = allowlistProblems(readAllowlist(), new Date());
    for (const problem of problems) console.error(problem);
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (command === "self-test") {
    reportSelfTest(
      scanKnownVulnerableFixture(),
      `osv-scanner reported ${knownVulnerableAdvisory} and failed on the known vulnerable fixture, as it should`,
    );
  } else if (command === "iac-self-test") {
    reportSelfTest(
      scanMisconfiguredIacFixture(),
      `trivy reported ${misconfiguredIacCheck} and failed on the misconfigured fixture, as it should`,
    );
  } else if (command === "scan") {
    process.exit(scanLockfiles());
  } else if (command === "iac") {
    process.exit(scanIac());
  } else if (command === "report") {
    const input: ReportInput = {
      today: new Date(),
      findings: collectFindings(),
      entries: readAllowlist(),
      iac: collectIacFindings(),
    };
    const markdown = buildReport(input);
    const output = process.argv[3];
    if (output) writeFileSync(output, markdown);
    else console.log(markdown);
    const problems = reportProblems(input);
    for (const problem of problems) console.error(problem);
    process.exit(problems.length === 0 ? 0 : 1);
  } else {
    console.error(
      "Usage: node scripts/osv-scan.ts [scan|self-test|iac|iac-self-test|report [file]|allowlist]",
    );
    process.exit(2);
  }
}
