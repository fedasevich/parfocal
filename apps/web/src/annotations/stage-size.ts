import { useEffect, useState } from "react";

export type StageRect = {
  readonly left: 0;
  readonly top: 0;
  readonly width: number;
  readonly height: number;
};

const rectOf = (stage: HTMLElement): StageRect => {
  const bounds = stage.getBoundingClientRect();
  return { left: 0, top: 0, width: bounds.width, height: bounds.height };
};

const same = (a: StageRect, b: StageRect) => a.width === b.width && a.height === b.height;

export function useStageRect(stage: HTMLElement): StageRect {
  const [rect, setRect] = useState<StageRect>(() => rectOf(stage));
  useEffect(() => {
    const refresh = () => setRect((old) => (same(old, rectOf(stage)) ? old : rectOf(stage)));
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);
  return rect;
}
