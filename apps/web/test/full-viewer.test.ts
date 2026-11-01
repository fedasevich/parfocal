import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeViewerSceneFor } from "../src/fake-api/viewer-scene-rules.ts";
import { mockScenes } from "../src/screens/scenes.ts";
import { presetProblem } from "../src/screens/viewer/preset-name.ts";
import {
  findingsObjects,
  isCompareScene,
  isLayersScene,
  isNavigatorScene,
  viewerSetup,
} from "../src/screens/viewer/viewer-scenes.ts";

test("the slide route's case and Visualize scenes never share a key", () => {
  const shared = mockScenes.case.filter((scene) =>
    (mockScenes.layers as readonly string[]).includes(scene),
  );
  assert.deepEqual(shared, []);
  for (const scene of mockScenes.layers) assert.ok(isLayersScene(scene), scene);
  for (const scene of mockScenes.case) assert.ok(!isLayersScene(scene), scene);
});

test("every scene list on the slide route is apart from the others", () => {
  const lists = {
    case: mockScenes.case,
    layers: mockScenes.layers,
    navigator: mockScenes.navigator,
    compare: mockScenes.compare,
  };
  const seen = new Map<string, string>();
  for (const [screen, scenes] of Object.entries(lists)) {
    for (const scene of scenes) {
      assert.equal(
        seen.get(scene),
        undefined,
        `${screen}/${scene} clashes with ${seen.get(scene)}`,
      );
      seen.set(scene, screen);
    }
  }
  for (const scene of mockScenes.navigator) assert.ok(isNavigatorScene(scene), scene);
  for (const scene of mockScenes.compare) assert.ok(isCompareScene(scene), scene);
  for (const scene of [...mockScenes.case, ...mockScenes.layers]) {
    assert.ok(!isNavigatorScene(scene) && !isCompareScene(scene), scene);
  }
});

test("annotate keeps its own route because its models scene would clash with Visualize", () => {
  assert.ok((mockScenes.layers as readonly string[]).includes("models"));
  assert.ok((mockScenes.annotate as readonly string[]).includes("models"));
});

test("every Visualize scene opens the Display tab with its view", () => {
  for (const scene of mockScenes.layers) assert.equal(viewerSetup(scene).tab, "display", scene);
  assert.equal(viewerSetup("heat").view, "heat");
  assert.equal(viewerSetup("display").view, "panel");
  assert.equal(viewerSetup("locked").confidenceLock, "Confidence hidden this round");
  assert.equal(viewerSetup("preset").preset, "Dots, no IDs");
  assert.equal(viewerSetup(undefined).tab, "objects");
  assert.equal(viewerSetup("submitfail").tab, "opinion");
});

test("the findings scenes pick T5, T2 and the added T6⁺", () => {
  assert.deepEqual(Object.keys(findingsObjects), [...mockScenes.findings]);
  assert.deepEqual(Object.values(findingsObjects), ["T5", "T2", "T6⁺"]);
});

test("only the running scene of the slide route makes the AI still read", () => {
  assert.equal(fakeViewerSceneFor("/projects/p/slides/s", { scene: "running" }), "running");
  assert.equal(fakeViewerSceneFor("/projects/p/slides/s", { scene: "heat" }), "ready");
  assert.equal(fakeViewerSceneFor("/projects/p/slides/s/report", { scene: "running" }), null);
  assert.equal(fakeViewerSceneFor("/my-work", {}), null);
});

test("a preset needs a name that is not taken", () => {
  assert.equal(presetProblem("  ", []), "Name the preset.");
  assert.equal(presetProblem("task default", []), "You already have a preset called Task default.");
  assert.equal(
    presetProblem("dots, no ids", ["Dots, no IDs"]),
    "You already have a preset called Dots, no IDs.",
  );
  assert.equal(presetProblem("Fill by score", ["Dots, no IDs"]), null);
});
