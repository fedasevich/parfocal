import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  allowlistPath,
  allowlistProblems,
  knownVulnerableAdvisory,
  osvScannerAvailable,
  parseAllowlist,
  scanKnownVulnerableFixture,
  selfTestProblem,
} from "./osv-scan.ts";

const today = new Date("2026-11-09T00:00:00Z");

function entry(overrides: Partial<{ id: string; ignoreUntil: string; reason: string }> = {}) {
  return {
    id: "GHSA-aaaa-bbbb-cccc",
    ignoreUntil: "2026-12-01T00:00:00Z",
    reason: "Waiting for upstream",
    ...overrides,
  };
}

describe("osv-scanner allowlist", () => {
  it("parses ids, dates and reasons", () => {
    const text =
      '[[IgnoredVulns]]\nid = "GHSA-1"\nignoreUntil = 2026-12-09T00:00:00Z\nreason = "Dev only"\n';
    assert.deepEqual(parseAllowlist(text), [
      { id: "GHSA-1", ignoreUntil: "2026-12-09T00:00:00Z", reason: "Dev only" },
    ]);
  });

  it("accepts a reasoned entry that expires within the window", () => {
    assert.deepEqual(allowlistProblems([entry()], today), []);
  });

  it("rejects entries with no reason, no expiry, a past expiry, a far expiry or a duplicate id", () => {
    assert.match(allowlistProblems([entry({ reason: "" })], today).join(), /no reason/);
    assert.match(allowlistProblems([entry({ ignoreUntil: "" })], today).join(), /no ignoreUntil/);
    assert.match(
      allowlistProblems([entry({ ignoreUntil: "2026-11-01T00:00:00Z" })], today).join(),
      /expired/,
    );
    assert.match(
      allowlistProblems([entry({ ignoreUntil: "2027-06-01T00:00:00Z" })], today).join(),
      /more than 90 days/,
    );
    assert.match(allowlistProblems([entry(), entry()], today).join(), /listed twice/);
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
