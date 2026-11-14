import { useEffect, useSyncExternalStore } from "react";
import { firstName, usePeople } from "../screens/project/people.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { reportPointer, useShownCursors } from "./cursor-bridge.ts";
import { pointOfShare, shareOfPoint } from "./shared-cursor.ts";

export function LiveCursor({
  x,
  y,
  user,
  mirrored = false,
}: {
  x: number;
  y: number;
  user: string;
  mirrored?: boolean;
}) {
  const person = usePeople().byId(user);
  return (
    <span
      data-testid="shared-cursor"
      data-user={user}
      role="img"
      aria-label={`${person.name} points here`}
      className="pointer-events-none absolute z-3 size-0"
      style={{ left: x, top: y }}
    >
      <span
        className="absolute -top-1.5 -left-1.5 size-3 rounded-full border-2 border-white shadow-[0_0_2px_#000]"
        style={{ background: person.color }}
      />
      <span
        data-slot="cursor-name"
        className="absolute top-2 left-2 rounded-full bg-black/70 px-1.5 py-0.5 text-caption whitespace-nowrap text-white"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      >
        {firstName(person)}
      </span>
    </span>
  );
}

type CursorEngine = Pick<ViewerEngine, "getCamera" | "getSlide" | "subscribeCamera">;

export function SharedCursorLayer({
  slideId,
  engine,
  stage,
}: {
  slideId: string;
  engine: CursorEngine;
  stage: HTMLElement;
}) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const cursors = useShownCursors(slideId);

  useEffect(() => {
    let last: { clientX: number; clientY: number } | null = null;
    const report = () => {
      const slide = engine.getSlide();
      if (last === null || slide === null) return;
      const rect = stage.getBoundingClientRect();
      const point = screenToSlide(engine.getCamera(), rect, last.clientX, last.clientY);
      reportPointer(slideId, shareOfPoint(point, slide));
    };
    const onMove = (event: PointerEvent) => {
      last = { clientX: event.clientX, clientY: event.clientY };
      report();
    };
    const onLeave = () => {
      last = null;
      reportPointer(slideId, null);
    };
    const parent = stage.parentElement ?? stage;
    parent.addEventListener("pointermove", onMove);
    parent.addEventListener("pointerleave", onLeave);
    const unsubscribe = engine.subscribeCamera(report);
    return () => {
      parent.removeEventListener("pointermove", onMove);
      parent.removeEventListener("pointerleave", onLeave);
      unsubscribe();
      onLeave();
    };
  }, [slideId, engine, stage]);

  const slide = engine.getSlide();
  if (cursors.length === 0 || slide === null) return null;
  const rect = stage.getBoundingClientRect();
  return cursors.map((cursor) => {
    const at = slideToScreen(camera, rect, pointOfShare(cursor.at, slide));
    const x = at.x - rect.left;
    const y = at.y - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    return <LiveCursor key={cursor.user} x={x} y={y} user={cursor.user} />;
  });
}
