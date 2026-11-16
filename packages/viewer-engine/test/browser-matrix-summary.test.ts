import assert from "node:assert/strict";
import { test } from "node:test";
import { cellsOf, matrixMarkdown } from "../browser-matrix/summary.ts";

const report = {
  suites: [
    {
      specs: [
        {
          title: "WebGL2 is offered",
          tests: [
            {
              projectName: "chromium",
              title: "WebGL2 is offered",
              results: [
                { status: "passed", annotations: [{ type: "support", description: '{"a":1}' }] },
              ],
            },
            {
              projectName: "webkit",
              title: "WebGL2 is offered",
              results: [{ status: "failed" }, { status: "passed" }],
            },
          ],
        },
        {
          title: "A drag pans",
          tests: [
            { projectName: "chromium", title: "A drag pans", results: [{ status: "failed" }] },
          ],
        },
      ],
    },
  ],
};

test("cells take the last attempt of each test and its support annotation", () => {
  const cells = cellsOf(report);
  assert.equal(cells.length, 3);
  assert.deepEqual(
    cells.map((cell) => `${cell.project} ${cell.status}`),
    ["chromium passed", "webkit passed", "chromium failed"],
  );
  assert.equal(cells[0]?.support, '{"a":1}');
});

test("the markdown lays out one row per check and one column per browser", () => {
  const markdown = matrixMarkdown(cellsOf(report));
  assert.match(markdown, /\| Check \| chromium \| webkit \|/);
  assert.match(markdown, /\| WebGL2 is offered \| pass \| pass \|/);
  assert.match(markdown, /\| A drag pans \| failed \| none \|/);
  assert.match(markdown, /- chromium: `\{"a":1\}`/);
});

test("an empty report says nothing was written", () => {
  assert.match(matrixMarkdown([]), /No results were written/);
});
