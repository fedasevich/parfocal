import type { CameraSearch } from "./camera-search.ts";

export function stepSlideId(ids: readonly string[], currentId: string, delta: 1 | -1) {
  const at = ids.indexOf(currentId);
  if (at < 0) return undefined;
  return ids[at + delta];
}

type RememberedCamera = Required<CameraSearch>;

const cameras = new Map<string, RememberedCamera>();

export function rememberSlideCamera(slideId: string, search: CameraSearch) {
  if (search.x === undefined || search.y === undefined || search.z === undefined) return;
  cameras.set(slideId, { x: search.x, y: search.y, z: search.z });
}

export function recallSlideCamera(slideId: string): CameraSearch {
  return cameras.get(slideId) ?? {};
}

export function forgetSlideCameras() {
  cameras.clear();
}
