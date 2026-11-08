import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkEntries,
  flakyIn,
  loadQuarantine,
  type QuarantineEntry,
  renderReport,
  scanTaggedTitles,
  taggedTitlesIn,
  today,
} from "./flaky.ts";

const entry: QuarantineEntry = {
  file: "apps/web/e2e/a.spec.ts",
  title: "drags the minimap",
  issue: "https://github.com/fedasevich/parfocal/issues/12",
  expires: "2026-12-01",
  reason: "reads once after mouse up",
};
const tagged = new Map([["apps/web/e2e/a.spec.ts", ["drags the minimap"]]]);

describe("flaky-quarantine.json", () => {
  it("has only live, tagged, linked entries today", () => {
    const root = new URL("../", import.meta.url).pathname;
    assert.deepEqual(
      checkEntries(loadQuarantine().quarantined, today(), scanTaggedTitles(root)),
      [],
    );
  });
});

describe("checkEntries", () => {
  it("accepts a complete entry", () => {
    assert.deepEqual(checkEntries([entry], "2026-11-09", tagged), []);
  });

  it("rejects an expired entry", () => {
    const problems = checkEntries([entry], "2026-12-02", tagged);
    assert.match(problems.join("\n"), /expired on 2026-12-01/);
  });

  it("rejects an expiry more than 30 days away", () => {
    const problems = checkEntries([{ ...entry, expires: "2027-03-01" }], "2026-11-09", tagged);
    assert.match(problems.join("\n"), /more than 30 days/);
  });

  it("rejects a missing issue link and a missing reason", () => {
    const problems = checkEntries([{ ...entry, issue: "TODO", reason: " " }], "2026-11-09", tagged);
    assert.equal(problems.length, 2);
  });

  it("rejects an entry without a tag and a tag without an entry", () => {
    assert.equal(checkEntries([entry], "2026-11-09", new Map()).length, 1);
    assert.equal(checkEntries([], "2026-11-09", tagged).length, 1);
  });
});

describe("taggedTitlesIn", () => {
  it("finds tests tagged for quarantine only", () => {
    const source = [
      'test("drags the minimap", { tag: "@quarantine" }, async () => {});',
      'test("stays live", { tag: "@fast" }, async () => {});',
      'test("plain", async () => {});',
    ].join("\n");
    assert.deepEqual(taggedTitlesIn(source), ["drags the minimap"]);
  });
});

describe("flakyIn and renderReport", () => {
  const report = {
    suites: [
      {
        file: "a.spec.ts",
        specs: [],
        suites: [
          {
            specs: [
              {
                title: "undo",
                file: "a.spec.ts",
                tests: [
                  {
                    projectName: "chromium",
                    status: "flaky",
                    results: [{ status: "failed" }, { status: "passed" }],
                  },
                ],
              },
              {
                title: "steady",
                file: "a.spec.ts",
                tests: [{ status: "expected", results: [{ status: "passed" }] }],
              },
              {
                title: "broken",
                file: "a.spec.ts",
                tests: [
                  { status: "unexpected", results: [{ status: "failed" }, { status: "failed" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("keeps tests that failed and then passed, and nothing else", () => {
    const found = flakyIn(report, "browser (web)", "apps/web");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.title, "undo");
    assert.equal(found[0]?.file, "apps/web/a.spec.ts");
    assert.equal(found[0]?.failedAttempts, 1);
  });

  it("lists quarantine entries with days left and flaky tests with counts", () => {
    const found = flakyIn(report, "browser (web)", "apps/web");
    const text = renderReport([entry], [...found, ...found], "2026-11-09", 7);
    assert.match(text, /\| 22 \|/);
    assert.match(text, /"undo" \| 2 \| browser \(web\)/);
  });

  it("flags an expired entry", () => {
    assert.match(renderReport([entry], [], "2027-01-01", 7), /EXPIRED/);
  });
});
