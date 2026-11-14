import type { FakeViewerScene } from "@parfocal/api-client/fake";

const slidePath = /^\/projects\/[^/]+\/slides\/[^/]+\/?$/;

export function fakeViewerSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeViewerScene | null {
  if (!slidePath.test(pathname)) return null;
  if (search["scene"] === "running") return "running";
  return search["scene"] === "streaming" ? "streaming" : "ready";
}
