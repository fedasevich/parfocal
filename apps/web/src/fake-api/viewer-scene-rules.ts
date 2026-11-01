import type { FakeViewerScene } from "@parfocal/api-client/fake";

const slidePath = /^\/projects\/[^/]+\/slides\/[^/]+\/?$/;

export function fakeViewerSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeViewerScene | null {
  if (!slidePath.test(pathname)) return null;
  return search["scene"] === "running" ? "running" : "ready";
}
