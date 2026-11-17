import { useEffect, useRef } from "react";
import { type StageStart, startCamera } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type { StageStart };

export function StageStartCamera({ engine, start }: { engine: ViewerEngine; start: StageStart }) {
  const applied = useRef(false);
  const wanted = useRef(start);
  wanted.current = start;
  useEffect(() => {
    const apply = () => {
      const slide = engine.getSlide();
      if (applied.current || slide === null) return;
      applied.current = true;
      engine.fitToSlide();
      engine.setCamera(startCamera(wanted.current, slide, engine.getCamera().zoom));
    };
    apply();
    return engine.subscribeCamera(apply);
  }, [engine]);
  return null;
}
