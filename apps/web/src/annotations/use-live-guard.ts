import { type RefObject, useEffect, useRef } from "react";
import { screenScale, type ViewerEngine } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import { pickShape } from "./hit-test.ts";
import { hitTolerancePx } from "./select-tool.ts";
import type { ShapeId } from "./shapes.ts";
import { slideAt } from "./stage-pointer.ts";
import type { LiveGuard } from "./use-saved-annotations.ts";

type Feed = {
  readonly engine: ViewerEngine | null;
  readonly stage: HTMLElement | null;
  readonly latest: () => AnnotationDocument;
  readonly noteActivity: () => void;
  readonly drafting: () => boolean;
  readonly selected: readonly ShapeId[];
};

type Pointer = { clientX: number; clientY: number; down: boolean };

export function useLiveGuardFeed(guard: RefObject<LiveGuard>, feed: Feed): void {
  const pointer = useRef<Pointer | null>(null);
  const current = useRef(feed);
  current.current = feed;
  const { stage } = feed;

  useEffect(() => {
    if (stage === null) return;
    const track = (event: PointerEvent) => {
      pointer.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        down: event.type === "pointerdown" || (event.type === "pointermove" && event.buttons > 0),
      };
      current.current.noteActivity();
    };
    const leave = () => {
      pointer.current = null;
    };
    const activity = () => current.current.noteActivity();
    const events = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
    for (const name of events) stage.addEventListener(name, track, true);
    stage.addEventListener("pointerleave", leave);
    stage.addEventListener("wheel", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      for (const name of events) stage.removeEventListener(name, track, true);
      stage.removeEventListener("pointerleave", leave);
      stage.removeEventListener("wheel", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [stage]);

  useEffect(() => {
    guard.current = {
      busy: () => (pointer.current?.down ?? false) || current.current.drafting(),
      shapeIds: () => {
        const held = new Set<ShapeId>(current.current.selected);
        const { engine, stage: host, latest } = current.current;
        const at = pointer.current;
        if (engine !== null && host !== null && at !== null) {
          const point = slideAt(engine, host, at);
          const tolerance = (hitTolerancePx * 2) / screenScale(engine.getCamera());
          const under = pickShape(latest(), point, tolerance);
          if (under !== null) held.add(under.id);
        }
        return held;
      },
    };
  }, [guard]);
}
