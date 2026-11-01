import type { FakeConnectModelScene } from "@parfocal/api-client/fake";

const scenes: Record<string, FakeConnectModelScene> = {
  addmodel: "untested",
  addtested: "passed",
  addfail: "failed",
  addmap: "passed",
};

export function fakeConnectModelSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeConnectModelScene | null {
  if (pathname !== "/admin") return null;
  const scene = search["scene"];
  return typeof scene === "string" ? (scenes[scene] ?? null) : null;
}
