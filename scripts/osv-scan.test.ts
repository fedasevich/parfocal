import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  allowlistPath,
  allowlistProblems,
  buildReport,
  iacSelfTestProblem,
  knownVulnerableAdvisory,
  misconfiguredIacCheck,
  osvScannerAvailable,
  parseAllowlist,
  parseOsvFindings,
  parseTrivyFindings,
  reportProblems,
  scanKnownVulnerableFixture,
  scanMisconfiguredIacFixture,
  selfTestProblem,
  severityFromScore,
  trivyAvailable,
} from "./osv-scan.ts";

const today = new Date("2026-11-09T00:00:00Z");

function entry(
  overrides: Partial<{ id: string; effectiveUntil: string; reason: string; severity: string }> = {},
) {
  return {
    id: "GHSA-aaaa-bbbb-cccc",
    effectiveUntil: "2026-12-01T00:00:00Z",
    reason: "[high] Waiting for upstream",
    severity: "high",
    ...overrides,
  };
}

const osvJson = JSON.stringify({
  results: [
    {
      packages: [
        {
          package: { name: "zod", version: "3.25.76", ecosystem: "npm" },
          groups: [{ ids: ["GHSA-zod"], aliases: ["CVE-1", "GHSA-zod"], max_severity: "8.2" }],
          vulnerabilities: [
            {
              id: "GHSA-zod",
              summary: "Memory | exhaustion",
              database_specific: { severity: "MODERATE" },
              affected: [
                {
                  package: { name: "zod" },
                  ranges: [{ events: [{ introduced: "0" }, { fixed: "4.6.6" }] }],
                },
              ],
            },
          ],
        },
        {
          package: { name: "deepmerge", version: "4.3.1", ecosystem: "npm" },
          groups: [{ ids: ["GHSA-deep"], aliases: ["GHSA-deep"], max_severity: "" }],
          vulnerabilities: [{ id: "GHSA-deep", database_specific: { severity: "LOW" } }],
        },
      ],
    },
  ],
});

describe("osv-scanner allowlist", () => {
  it("parses ids, dates, reasons and the severity prefix of the reason", () => {
    const text =
      '[[IgnoredVulns]]\nid = "GHSA-1"\neffectiveUntil = 2026-12-09T00:00:00Z\nreason = "[low] Dev only"\n' +
      '[[IgnoredVulns]]\nid = "GHSA-2"\nignoreUntil = 2026-12-09T00:00:00Z\nreason = "No prefix"\n';
    assert.deepEqual(parseAllowlist(text), [
      {
        id: "GHSA-1",
        effectiveUntil: "2026-12-09T00:00:00Z",
        reason: "[low] Dev only",
        severity: "low",
      },
      { id: "GHSA-2", effectiveUntil: "2026-12-09T00:00:00Z", reason: "No prefix", severity: "" },
    ]);
  });

  it("accepts a reasoned entry that expires within the window", () => {
    assert.deepEqual(allowlistProblems([entry()], today), []);
  });

  it("rejects entries with no reason, no expiry, a past expiry, a far expiry or a duplicate id", () => {
    assert.match(allowlistProblems([entry({ reason: "" })], today).join(), /no reason/);
    assert.match(
      allowlistProblems([entry({ effectiveUntil: "" })], today).join(),
      /no effectiveUntil/,
    );
    assert.match(
      allowlistProblems([entry({ effectiveUntil: "2026-11-01T00:00:00Z" })], today).join(),
      /expired/,
    );
    assert.match(
      allowlistProblems([entry({ effectiveUntil: "2027-06-01T00:00:00Z" })], today).join(),
      /more than 90 days/,
    );
    assert.match(allowlistProblems([entry(), entry()], today).join(), /listed twice/);
    assert.match(allowlistProblems([entry({ severity: "" })], today).join(), /no severity/);
  });

  it("holds each entry to the SLA of its severity", () => {
    const in20Days = "2026-11-29T00:00:00Z";
    const in60Days = "2027-01-08T00:00:00Z";
    assert.match(
      allowlistProblems([entry({ severity: "critical", effectiveUntil: in20Days })], today).join(),
      /critical and may be allowed for at most 7 days/,
    );
    assert.deepEqual(
      allowlistProblems([entry({ severity: "high", effectiveUntil: in20Days })], today),
      [],
    );
    assert.match(
      allowlistProblems([entry({ severity: "high", effectiveUntil: in60Days })], today).join(),
      /at most 30 days/,
    );
    assert.deepEqual(
      allowlistProblems([entry({ severity: "medium", effectiveUntil: in60Days })], today),
      [],
    );
  });

  it("keeps the committed allowlist reasoned and bounded", () => {
    const entries = parseAllowlist(
      readFileSync(new URL(`../${allowlistPath}`, import.meta.url), "utf8"),
    );
    assert.ok(entries.length > 0);
    const problems = allowlistProblems(entries, new Date()).filter(
      (problem) => !problem.includes("expired"),
    );
    assert.deepEqual(problems, []);
  });
});

describe("severity and report", () => {
  it("rates a finding by the worse of its label and its score", () => {
    const [zod, deepmerge] = parseOsvFindings(osvJson);
    assert.equal(zod?.severity, "high");
    assert.deepEqual(zod?.fixed, ["4.6.6"]);
    assert.deepEqual(zod?.ids, ["GHSA-zod", "CVE-1"]);
    assert.equal(deepmerge?.severity, "low");
    assert.equal(severityFromScore("9.1"), "critical");
    assert.equal(severityFromScore("3.7"), "low");
    assert.equal(severityFromScore(""), null);
  });

  it("reports open findings, under-rated entries, stale entries and misconfigurations", () => {
    const findings = parseOsvFindings(osvJson);
    const entries = [
      entry({ id: "CVE-1", severity: "medium", reason: "[medium] Waiting | upstream" }),
      entry({ id: "GHSA-gone" }),
    ];
    const iac = parseTrivyFindings(
      JSON.stringify({
        Results: [
          {
            Target: "main.tf",
            Misconfigurations: [
              { ID: "AWS-0107", Severity: "HIGH", Title: "Open ingress", Status: "FAIL" },
              { ID: "AWS-0001", Severity: "LOW", Title: "Fine", Status: "PASS" },
            ],
          },
        ],
      }),
    );
    const input = { today, findings, entries, iac };
    const problems = reportProblems(input).join("\n");
    assert.match(problems, /GHSA-deep \(low\) in deepmerge 4.3.1 is not allowlisted/);
    assert.match(problems, /CVE-1 is listed as medium but zod 3.25.76 rates it high/);
    assert.match(problems, /AWS-0107 \(high\) in main.tf/);
    assert.doesNotMatch(problems, /AWS-0001/);
    const report = buildReport(input);
    assert.match(report, /# Vulnerability report 2026-11-09/);
    assert.match(report, /\| GHSA-deep \| low \| npm deepmerge 4.3.1 \| no fix \|/);
    assert.ok(report.includes("Waiting \\| upstream"));
    assert.match(report, /GHSA-gone matches no finding/);
    assert.match(report, /critical 7 days, high 30 days, medium 90 days/);
  });

  it("calls a run clean when every finding is allowlisted within its SLA", () => {
    const findings = parseOsvFindings(osvJson);
    const entries = [entry({ id: "GHSA-zod" }), entry({ id: "GHSA-deep", severity: "low" })];
    const input = { today, findings, entries, iac: [] };
    assert.deepEqual(reportProblems(input), []);
    assert.match(buildReport(input), /Status: clean/);
    assert.match(buildReport({ ...input, iac: null }), /trivy is not installed/);
  });
});

describe("known vulnerable dependency", () => {
  it("counts only a findings exit with the expected advisory as a pass", () => {
    assert.equal(selfTestProblem(1, `{"id":"${knownVulnerableAdvisory}"}`), null);
    assert.match(selfTestProblem(0, "{}") ?? "", /exited with 0/);
    assert.match(selfTestProblem(127, "") ?? "", /exited with 127/);
    assert.match(selfTestProblem(1, '{"id":"GHSA-other"}') ?? "", /did not report/);
  });

  it("fails the scan on the fixture lockfile", {
    skip: !osvScannerAvailable() && "osv-scanner is not installed",
  }, () => {
    assert.equal(scanKnownVulnerableFixture(), null);
  });
});

describe("known misconfigured infrastructure", () => {
  it("counts only a findings exit with the expected check as a pass", () => {
    assert.equal(iacSelfTestProblem(1, `{"ID":"${misconfiguredIacCheck}"}`), null);
    assert.match(iacSelfTestProblem(0, "{}") ?? "", /exited with 0/);
    assert.match(iacSelfTestProblem(1, '{"ID":"AWS-0001"}') ?? "", /did not report/);
  });

  it("fails the scan on the fixture module", {
    skip: !trivyAvailable() && "trivy is not installed",
  }, () => {
    assert.equal(scanMisconfiguredIacFixture(), null);
  });
});
