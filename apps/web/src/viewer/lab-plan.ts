import { type LabSettings, nucleiCountOf } from "../lab/lab-settings.ts";

export const builtRenderers: readonly LabSettings["renderer"][] = ["viv"];

const rendererNames: Record<LabSettings["renderer"], string> = {
  viv: "Viv",
  webgpu: "WebGPU",
  deck: "deck.gl",
};

export type LabViewerPlan = {
  readonly route: "viv";
  readonly routeNote: string | null;
  readonly cull: boolean;
  readonly detailLevel: LabSettings["detailLevel"];
  readonly nucleiCount: number;
  readonly hud: boolean;
  readonly motionVector: boolean;
  readonly pauseModels: boolean;
};

export function labViewerPlan(settings: LabSettings): LabViewerPlan {
  const built = builtRenderers.includes(settings.renderer);
  return {
    route: "viv",
    routeNote: built
      ? null
      : `The ${rendererNames[settings.renderer]} route is not built yet. Showing Viv.`,
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
