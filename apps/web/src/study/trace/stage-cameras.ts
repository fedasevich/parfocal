import { stageEngines } from "../../presence/stage-engines.ts";
import type { CameraSample } from "./trace-model.ts";

const stageSelector = '[data-testid="slide-stage"]';

export function readStageCameras(doc: Document = document): CameraSample[] {
  const stage = doc.querySelector(stageSelector)?.getBoundingClientRect();
  return stageEngines().flatMap(([slideId, engine]) => {
    const slide = engine.getSlide();
    if (slide === null) return [];
    const camera = engine.getCamera();
    return [
      {
        slide: slideId,
        x: Math.round(camera.x),
        y: Math.round(camera.y),
        zoom: Math.round(camera.zoom * 100) / 100,
        w: slide.width,
        h: slide.height,
        vw: Math.round(stage?.width ?? 0),
        vh: Math.round(stage?.height ?? 0),
      },
    ];
  });
}
