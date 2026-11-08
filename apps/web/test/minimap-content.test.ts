import assert from "node:assert/strict";
import { test } from "node:test";
import { minimapContent } from "../src/screens/viewer-tools/minimap-content.ts";

const cells = [
  { point: [10, 20] as [number, number], decided: false },
  { point: [30, 40] as [number, number], decided: true },
  { point: [50, 60] as [number, number], decided: true },
];

test("reading mode shows the trail, the areas, the viewport and the seen text", () => {
  assert.deepEqual(
    minimapContent({
      mode: "reading",
      areaCount: 5,
      decidedCount: 2,
      position: 3,
      magnification: 9.6,
      cells,
      travel: null,
    }),
    {
      layers: ["trail", "areas", "viewport"],
      title: { strong: "Whole slide", rest: " · 21% seen" },
      foot: "3 of 5",
      footEnd: "10× · 2 of 5 decided",
      dots: null,
      route: null,
    },
  );
});

test("area mode draws the outline, the checked cells first and the next cell as current", () => {
  assert.deepEqual(
    minimapContent({
      mode: "area",
      areaCount: 5,
      decidedCount: 2,
      position: 2,
      magnification: 20,
      cells,
      travel: null,
    }),
    {
      layers: ["outline", "dots", "viewport"],
      title: { strong: "", rest: "" },
      foot: "Area 2",
      footEnd: "2 of 3 checked",
      dots: {
        points: [
          [30, 40],
          [50, 60],
          [10, 20],
        ],
        done: 2,
        current: 2,
      },
      route: null,
    },
  );
});

test("the locator keeps the dots and drops the viewport", () => {
  const content = minimapContent({
    mode: "locator",
    areaCount: 5,
    decidedCount: 2,
    position: 2,
    magnification: 40,
    cells,
    travel: null,
  });
  assert.deepEqual(content.layers, ["outline", "dots"]);
});

test("travel mode names the target, its distance and the route", () => {
  assert.deepEqual(
    minimapContent({
      mode: "travel",
      areaCount: 5,
      decidedCount: 2,
      position: 2,
      magnification: 10,
      cells: [],
      travel: { label: "area 3", mm: 1.234, from: [1, 2], to: [3, 4] },
    }),
    {
      layers: ["trail", "areas", "route", "viewport"],
      title: { strong: "Going to area 3", rest: " · 1.2 mm" },
      foot: "Press ] again to skip",
      footEnd: "",
      dots: null,
      route: { from: [1, 2], to: [3, 4] },
    },
  );
});
