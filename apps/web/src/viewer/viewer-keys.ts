import { presetForDigit } from "@parfocal/ui/lib/magnification-bar";
import { actionOf, type Resolve } from "../keys/actions.ts";
import { keyRegistry } from "../keys/catalogue.ts";
import type { Binding, Fired } from "../keys/registry.ts";

export type PanDirection = "up" | "down" | "left" | "right";

export type ViewerKeyTarget = {
  zoomOctaves: number;
  zoomBy: (octaves: number) => void;
  fit: () => void;
  zoomToMagnification: (magnification: number) => void;
  press: (direction: PanDirection, fast: boolean) => void;
  release: (direction: PanDirection) => void;
  back: () => void;
  forward: () => void;
};

export const viewerKeyIds = [
  "zoomin",
  "zoomout",
  "fit",
  "mag",
  "pan",
  "viewback",
  "viewforward",
] as const;

const directions = new Set<string>(["up", "down", "left", "right"]);

export function viewerKeyBindings(options: Omit<Resolve, "scopes" | "only"> = {}): Binding[] {
  return keyRegistry.bindings({ ...options, scopes: ["viewer"], only: viewerKeyIds });
}

export function applyViewerKey(fired: Fired, target: ViewerKeyTarget, shift: boolean): void {
  const { id, suffix } = actionOf(fired.action);
  if (id === "pan" && directions.has(suffix)) {
    const direction = suffix as PanDirection;
    if (fired.phase === "press") target.press(direction, shift);
    else if (fired.phase === "release") target.release(direction);
    return;
  }
  if (fired.phase !== "press") return;
  if (id === "zoomin") target.zoomBy(target.zoomOctaves);
  else if (id === "zoomout") target.zoomBy(-target.zoomOctaves);
  else if (id === "fit") target.fit();
  else if (id === "viewback") target.back();
  else if (id === "viewforward") target.forward();
  else if (id === "mag") {
    const preset = presetForDigit(Number(suffix));
    if (preset !== null) target.zoomToMagnification(preset);
  }
}
