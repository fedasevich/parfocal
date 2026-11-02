import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type Budget, exceeds, loadBudgets, maxHeadroom, regressionRule } from "./perf-budgets.ts";

const repoRoot = new URL("../", import.meta.url);
const file = await loadBudgets();

function exists(path: string): boolean {
  return existsSync(new URL(path, repoRoot));
}

function measured(entry: Budget): { baseline: number; limit: number } {
  assert.equal(typeof entry.baseline, "number", `${entry.id} has no baseline`);
  assert.equal(typeof entry.limit, "number", `${entry.id} has no limit`);
  return { baseline: entry.baseline ?? 0, limit: entry.limit ?? 0 };
}

describe("perf-budgets.json", () => {
  it("names every budget once", () => {
    const ids = file.budgets.map((entry) => entry.id);
    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it("links an ADR, a check and any result that exist", () => {
    for (const entry of file.budgets) {
      assert.match(entry.adr, /^docs\/adr\/[\dX]{4}-[a-z0-9-]+\.md$/, entry.id);
      assert.ok(exists(entry.adr), `${entry.id} links ${entry.adr}, which does not exist`);
      assert.ok(exists(entry.check), `${entry.id} names ${entry.check}, which does not exist`);
      if (entry.result !== null) {
        assert.ok(exists(entry.result), `${entry.id} links ${entry.result}, which does not exist`);
      }
    }
  });

  it("checks every CI budget by its id in the test it names", () => {
    for (const entry of file.budgets.filter((budget) => budget.kind !== "manual")) {
      const source = readFileSync(new URL(entry.check, repoRoot), "utf8");
      assert.ok(source.includes(`"${entry.id}"`), `${entry.check} never checks ${entry.id}`);
    }
  });

  it("fails a 20 percent regression of every byte and count budget", () => {
    for (const entry of file.budgets.filter(
      (budget) => budget.kind === "bytes" || budget.kind === "count",
    )) {
      const { baseline, limit } = measured(entry);
      assert.ok(limit >= baseline, `${entry.id} is already over its limit`);
      assert.ok(limit <= baseline * regressionRule, `${entry.id} allows more than 20 percent`);
      assert.notEqual(exceeds(entry, baseline * regressionRule + 1), null, entry.id);
      assert.equal(exceeds(entry, baseline), null, entry.id);
    }
  });

  it("gives every time budget one RTT, a declared headroom and a reason", () => {
    for (const entry of file.budgets.filter((budget) => budget.kind === "ms")) {
      const { baseline, limit } = measured(entry);
      const headroom = entry.headroom ?? 0;
      assert.ok(headroom > 1 && headroom <= maxHeadroom, `${entry.id} headroom ${headroom}`);
      assert.ok((entry.headroomReason ?? "").length > 0, `${entry.id} gives no reason`);
      assert.equal(typeof entry.rttMs, "number", `${entry.id} names no RTT`);
      assert.ok(limit >= baseline && limit <= baseline * headroom, `${entry.id} limit ${limit}`);
    }
  });

  it("records every manual budget in a result file or says what is missing", () => {
    for (const entry of file.budgets.filter((budget) => budget.kind === "manual")) {
      assert.ok(entry.result !== null || (entry.todo ?? "").length > 0, entry.id);
      if (entry.limit === null) assert.ok((entry.todo ?? "").length > 0, entry.id);
    }
  });
});
