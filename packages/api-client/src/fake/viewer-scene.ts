export type FakeViewerScene = "ready" | "running";

let scene: FakeViewerScene = "ready";

export function fakeViewerScene(): FakeViewerScene {
  return scene;
}

export function setFakeViewerScene(next: FakeViewerScene | null): boolean {
  if (next === null || next === scene) return false;
  scene = next;
  return true;
}
