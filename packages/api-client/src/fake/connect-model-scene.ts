export type FakeConnectModelScene = "untested" | "passed" | "failed";

let scene: FakeConnectModelScene = "untested";

export function fakeConnectModelScene(): FakeConnectModelScene {
  return scene;
}

export function setFakeConnectModelScene(next: FakeConnectModelScene | null): boolean {
  if (next === null || next === scene) return false;
  scene = next;
  return true;
}
