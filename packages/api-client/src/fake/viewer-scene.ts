export type FakeViewerScene = "ready" | "running" | "streaming";

export type FakeViewerIssue = "withdrawn" | "noresults" | "running";

const viewerIssues: readonly FakeViewerIssue[] = ["withdrawn", "noresults", "running"];

let scene: FakeViewerScene = "ready";
let issue: FakeViewerIssue | null = null;
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

export function fakeViewerIssue(): FakeViewerIssue | null {
  return issue;
}

export function setFakeViewerIssue(next: unknown): void {
  issue = viewerIssues.find((candidate) => candidate === next) ?? null;
  reads = 0;
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
