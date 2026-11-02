import type { LinkedView } from "@parfocal/viewer-engine";
import type { Camera } from "../review/slide-still.tsx";

export function viewOfCamera(camera: Camera | null): LinkedView | null {
  return camera === null
    ? null
    : { x: camera.x, y: camera.y, zoom: Math.log2(camera.scale), rotation: 0 };
}

export function cameraOfView(view: LinkedView | null): Camera | null {
  return view === null ? null : { x: view.x, y: view.y, scale: 2 ** view.zoom };
}
