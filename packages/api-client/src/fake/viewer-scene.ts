export type FakeViewerScene = "ready" | "running";

let scene: FakeViewerScene = "ready";
let reads = 0;
let streaming = false;

export function fakeViewerScene(): FakeViewerScene {
  return scene;
}

export function setFakeViewerScene(next: FakeViewerScene | null): boolean {
  if (next === null || next === scene) return false;
  scene = next;
  reads = 0;
  return true;
}

export function setFakeAiStreaming(on: boolean): void {
  streaming = on;
  reads = 0;
}

export function nextFakeProgressRead(): number {
  if (!streaming) return 1;
  reads += 1;
  return reads;
}
