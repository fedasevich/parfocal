import {
  type LinkedView,
  type LinkedViews,
  moveView,
  type Registration,
  type ViewOffset,
} from "@parfocal/viewer-engine";
import type { Camera } from "../review/slide-still.tsx";

export const rotationStep = 15;

export function viewOfCamera(camera: Camera | null, rotation = 0): LinkedView | null {
  return camera === null
    ? null
    : { x: camera.x, y: camera.y, zoom: Math.log2(camera.scale), rotation };
}

export function cameraOfView(view: LinkedView | null): Camera | null {
  return view === null ? null : { x: view.x, y: view.y, scale: 2 ** view.zoom };
}

export function rotationOfView(view: LinkedView | null): number {
  return view === null ? 0 : view.rotation;
}

export function offsetFromRegistration(
  registration: Registration,
  size: { width: number; height: number },
  centre: { x: number; y: number },
): ViewOffset {
  const radians = (registration.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rx = centre.x - size.width / 2;
  const ry = centre.y - size.height / 2;
  return {
    x: rx * cos - ry * sin + size.width / 2 + registration.shiftX * size.width - centre.x,
    y: rx * sin + ry * cos + size.height / 2 + registration.shiftY * size.height - centre.y,
    zoom: 0,
    rotation: -registration.rotation,
  };
}

export const wrapDegrees = (degrees: number): number =>
  ((((degrees + 180) % 360) + 360) % 360) - 180;

export function moveCameraKeepingRotation<Pane extends string>(
  state: LinkedViews<Pane>,
  pane: NoInfer<Pane>,
  camera: Camera | null,
): LinkedViews<Pane> {
  return moveView(state, pane, viewOfCamera(camera, rotationOfView(state.views[pane])));
}

export function rotatePane<Pane extends string>(
  state: LinkedViews<Pane>,
  pane: NoInfer<Pane>,
  shown: Camera,
  change: { by: number } | { to: number },
): LinkedViews<Pane> {
  const current = state.views[pane] ?? viewOfCamera(shown);
  if (current === null) return state;
  const rotation = wrapDegrees("by" in change ? current.rotation + change.by : change.to);
  return moveView(state, pane, { ...current, rotation });
}
