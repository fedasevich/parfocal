import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { typeScaleProblems } from "@parfocal/tokens/type-scale-lint";

const repo = new URL("../../../", import.meta.url);

const roots = ["packages/ui/src", "packages/ui/stories", "apps/web/src"];

const printedPage = "draws a printed page at reduced size, on the paper scale";
const mark = "a glyph sized to the graphic mark it sits in";

const allowed: Record<string, string> = {
  "packages/ui/src/components/evaluation-report.tsx": printedPage,
  "packages/ui/src/components/clinical-report.tsx": printedPage,
  "packages/ui/src/components/report-templates.tsx": printedPage,
  "packages/ui/src/components/report-editor-pages.tsx": printedPage,
  "apps/web/src/screens/evaluation/report-pages.tsx": printedPage,
  "packages/ui/src/components/person.tsx": mark,
  "packages/ui/src/components/auth.tsx": mark,
  "packages/ui/src/components/jobs.tsx": mark,
  "packages/ui/src/components/progress-meter.tsx": mark,
  "packages/ui/src/components/tool-rail-button.tsx": mark,
  "apps/web/src/screens/review/slide-still.tsx": mark,
};

const sources = roots.flatMap((root) =>
  readdirSync(new URL(root, repo), { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(tsx?|css)$/.test(path) && !path.includes("node_modules"))
    .map((path) => `${root}/${path}`),
);

test("every font size in the app and kit comes from the type scale", () => {
  assert.ok(sources.length > 100);
  const found = sources
    .filter((path) => !(path in allowed))
    .flatMap((path) => {
      const kind = path.endsWith(".css") ? "css" : "script";
      return typeScaleProblems(readFileSync(new URL(path, repo), "utf8"), kind).map(
        (problem) => `${path}:${problem.line} ${problem.found}: ${problem.reason}`,
      );
    });
  assert.deepEqual(found, []);
});

test("every allowed file still needs its exception", () => {
  for (const path of Object.keys(allowed)) {
    const kind = path.endsWith(".css") ? "css" : "script";
    const problems = typeScaleProblems(readFileSync(new URL(path, repo), "utf8"), kind);
    assert.ok(problems.length > 0, `${path} is on the scale now, drop it from the list`);
  }
});
