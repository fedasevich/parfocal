import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChunkInput,
  firstPageFileNames,
  packageOf,
  summarizeBundle,
} from "../vite/bundle-summary.ts";

const chunks: ChunkInput[] = [
  {
    fileName: "assets/index-a.js",
    code: "a".repeat(1000),
    isEntry: true,
    imports: ["assets/vendor-b.js"],
    modules: { "src/main.tsx": 300, "src/app.tsx": 700 },
  },
  {
    fileName: "assets/vendor-b.js",
    code: "b".repeat(5000),
    isEntry: false,
    imports: [],
    modules: {
      "../../node_modules/.pnpm/react@19/node_modules/react/index.js": 4000,
      "../../node_modules/.pnpm/@scope+lib@1/node_modules/@scope/lib/dist/a.js": 900,
      "src/small.ts": 100,
    },
  },
  {
    fileName: "assets/viewer-engine-c.js",
    code: "c".repeat(9000),
    isEntry: false,
    imports: ["assets/vendor-b.js"],
    modules: { "../../packages/viewer-engine/src/engine.ts": 9000 },
  },
];

test("the first page is the entry chunks and what they import, not lazy chunks", () => {
  assert.deepEqual(
    [...firstPageFileNames(chunks)].sort(),
    ["assets/index-a.js", "assets/vendor-b.js"].sort(),
  );
});

test("the summary names the largest modules of the first-page chunks, biggest first", () => {
  const summary = summarizeBundle(chunks, 3);
  assert.deepEqual(summary.firstPage.largestModules, [
    { id: "../../node_modules/.pnpm/react@19/node_modules/react/index.js", bytes: 4000 },
    { id: "../../node_modules/.pnpm/@scope+lib@1/node_modules/@scope/lib/dist/a.js", bytes: 900 },
    { id: "src/app.tsx", bytes: 700 },
  ]);
  assert.ok(!summary.firstPage.largestModules.some((entry) => entry.id.includes("viewer-engine")));
});

test("the summary lists every chunk with its modules and gzip size, largest gzip first", () => {
  const summary = summarizeBundle(chunks);
  assert.equal(summary.chunks.length, 3);
  assert.deepEqual([...summary.firstPage.chunks].sort(), [
    "assets/index-a.js",
    "assets/vendor-b.js",
  ]);
  const viewer = summary.chunks.find((chunk) => chunk.fileName === "assets/viewer-engine-c.js");
  assert.equal(viewer?.firstPage, false);
  assert.equal(viewer?.bytes, 9000);
  assert.ok((viewer?.gzipBytes ?? 0) > 0 && (viewer?.gzipBytes ?? 0) < 9000);
  const sizes = summary.chunks.map((chunk) => chunk.gzipBytes);
  assert.deepEqual(
    sizes,
    [...sizes].sort((a, b) => b - a),
  );
  const firstPageGzip = summary.chunks
    .filter((chunk) => chunk.firstPage)
    .reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
  assert.equal(summary.firstPage.gzipBytes, firstPageGzip);
  assert.equal(
    summary.totalGzipBytes,
    summary.chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
  );
});

test("packages are grouped by the innermost node_modules folder", () => {
  assert.equal(packageOf("../../node_modules/.pnpm/react@19/node_modules/react/index.js"), "react");
  assert.equal(
    packageOf("../../node_modules/.pnpm/x/node_modules/@scope/lib/dist/a.js"),
    "@scope/lib",
  );
  assert.equal(packageOf("src/app.tsx"), "application");
  const summary = summarizeBundle(chunks);
  assert.deepEqual(summary.firstPage.largestPackages[0], { name: "react", bytes: 4000 });
});
