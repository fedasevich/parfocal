import { useEffect, useRef } from "react";
import { taskTimer } from "./app-events.ts";
import { measureChromeShare } from "./chrome-coverage.ts";
import type { Area, TaskKind } from "./task-timer.ts";

const chromeSettleMs = 1200;

export function useTaskRun(kind: TaskKind, id: string, area: Area) {
  useEffect(() => {
    if (id === "") return;
    taskTimer.start(kind, id);
    taskTimer.areaEntered();
    return () => {
      taskTimer.areaLeft(area);
      taskTimer.abandon(kind, id);
    };
  }, [kind, id, area]);
  return { finish: () => taskTimer.finish(kind, id) };
}

export function useCellTiming(objectId: string | undefined, isCell: boolean) {
  useEffect(() => {
    if (isCell && objectId !== undefined) taskTimer.cellShown();
  }, [objectId, isCell]);
}

export function useChromeSampling(area: Area, layoutKey: string) {
  const sampled = useRef(new Set<string>());
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (sampled.current.has(layoutKey)) return;
      sampled.current.add(layoutKey);
      taskTimer.chromeMeasured(area, measureChromeShare());
    }, chromeSettleMs);
    return () => window.clearTimeout(timer);
  }, [area, layoutKey]);
}
