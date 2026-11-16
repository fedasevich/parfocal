import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  gate,
  linePercent,
  parseLcov,
  renderTable,
  setupProblems,
  type WorkspacePackage,
  workspacePackages,
} from "./coverage-gate.ts";

const lcov = [
  "SF:src/a.ts",
  "LF:10",
  "LH:8",
  "end_of_record",
  "SF:src/b.ts",
  "LF:10",
  "LH:10",
  "end_of_record",
].join("\n");

function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "coverage-gate-"));
  const add = (dir: string, manifest: object, report?: string) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
    if (report !== undefined) writeFileSync(join(root, dir, "coverage.lcov"), report);
  };
  const test =
    'node --test --test-reporter=lcov --test-reporter-destination=coverage.lcov "test/**"';
  add("packages/good", { name: "@x/good", scripts: { test }, coverage: { lines: 85 } }, lcov);
  add("packages/low", { name: "@x/low", scripts: { test }, coverage: { lines: 95 } }, lcov);
  add("packages/missing", { name: "@x/missing", scripts: { test }, coverage: { lines: 10 } });
  add("apps/docs", { name: "@x/docs" });
  return root;
}

describe("coverage gate", () => {
  it("sums line totals across every file in an lcov report", () => {
    assert.deepEqual(parseLcov(lcov), { found: 20, hit: 18 });
    assert.equal(linePercent({ found: 20, hit: 18 }), 90);
    assert.equal(linePercent({ found: 0, hit: 0 }), 100);
  });

  it("passes packages at their minimum and fails low or missing reports", () => {
    const root = fakeRepo();
    try {
      const rows = gate(root, workspacePackages(root));
      assert.deepEqual(
        rows.map((row) => [row.dir, row.lines, row.passed]),
        [
          ["packages/good", 90, true],
          ["packages/low", 90, false],
          ["packages/missing", undefined, false],
        ],
      );
      assert.match(renderTable(rows), /\| @x\/missing \| no report \| 10% \| FAIL \|/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("asks every tested package for a report and a minimum", () => {
    const pkg: WorkspacePackage = {
      dir: "packages/a",
      name: "a",
      testScript: "node --test",
      minLines: undefined,
    };
    assert.deepEqual(setupProblems([pkg]), [
      "packages/a test script must write coverage.lcov",
      "packages/a package.json needs coverage.lines between 0 and 100",
    ]);
  });

  it("finds every workspace package with tests set up for the gate", () => {
    const root = new URL("../", import.meta.url).pathname;
    const packages = workspacePackages(root).filter((pkg) => pkg.testScript !== undefined);
    assert.ok(packages.length >= 10);
    assert.deepEqual(setupProblems(packages), []);
  });
});
