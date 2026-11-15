import { type LabSettings, nucleiCountOf } from "../lab/lab-settings.ts";
import { type EngineRouteId, engineRouteOf } from "./route-picker.ts";

export const builtRenderers: readonly LabSettings["renderer"][] = ["viv", "deck"];

const rendererNames: Record<LabSettings["renderer"], string> = {
  viv: "Viv",
  webgpu: "WebGPU",
  deck: "deck.gl",
};

const routeNoteOf = (settings: LabSettings, shown: EngineRouteId | null): string | null => {
  if (!builtRenderers.includes(settings.renderer)) {
    return `The ${rendererNames[settings.renderer]} route is not built yet. Showing Viv.`;
  }
  if (shown === null || shown === engineRouteOf[settings.renderer]) return null;
  return `The ${rendererNames[settings.renderer]} route could not show this slide. Showing Viv.`;
};

export type LabViewerPlan = {
  readonly route: EngineRouteId;
  readonly routeNote: string | null;
  readonly cull: boolean;
  readonly detailLevel: LabSettings["detailLevel"];
  readonly nucleiCount: number;
  readonly hud: boolean;
  readonly motionVector: boolean;
  readonly pauseModels: boolean;
};

export function labViewerPlan(
  settings: LabSettings,
  shown: EngineRouteId | null = null,
): LabViewerPlan {
  return {
    route: engineRouteOf[settings.renderer],
    routeNote: routeNoteOf(settings, shown),
    cull: settings.culling !== "none",
    detailLevel: settings.detailLevel,
    nucleiCount: nucleiCountOf(settings),
    hud: settings.hud,
    motionVector: settings.motionVector,
    pauseModels: settings.pauseModels,
  };
}

export type DetailDraw = { mode: "circle" | "dot" | "density"; alpha: number };

const circleFromPixels = 3;
const dotFromPixels = 0.8;

export function detailDraw(level: LabSettings["detailLevel"], screenRadius: number): DetailDraw {
  if (level === "off") return { mode: "circle", alpha: 1 };
  if (level === "fade") {
    return { mode: "circle", alpha: Math.min(1, screenRadius / circleFromPixels) };
  }
  if (level === "dots") return { mode: "dot", alpha: 1 };
  if (level === "density") return { mode: "density", alpha: 1 };
  if (screenRadius >= circleFromPixels) return { mode: "circle", alpha: 1 };
  if (screenRadius >= dotFromPixels) return { mode: "dot", alpha: 1 };
  return { mode: "density", alpha: 1 };
}

export type SlideRect = { left: number; top: number; right: number; bottom: number };

export const insideView = (view: SlideRect, x: number, y: number): boolean =>
  x >= view.left && x <= view.right && y >= view.top && y <= view.bottom;
