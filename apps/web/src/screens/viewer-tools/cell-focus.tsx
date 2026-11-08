import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { FloatingPill } from "@parfocal/ui/components/viewer-tools";
import { useEffect, useState } from "react";
import { useAnswerKeys } from "../review/answer-keys.ts";
import { answersOf, countsAs } from "../review/decision-style.ts";
import { cellShapes, regionShapes } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { useDecisionSaves } from "../review/use-decision-saves.ts";
import { lookUrl } from "../thumbnails.ts";
import {
  type CellSpot,
  type Direction,
  jumpTarget,
  nearestOpen,
  placeBar,
} from "./cell-focus-geometry.ts";
import { overviewExtent } from "./minimap-scenes.ts";
import type { ToolSession } from "./tool-session.tsx";

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const directions: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const fadedCell = () => ({ stroke: "#ffffff", opacity: 0.12 });
const ringRadius = 24;
const barHeight = 48;
const buttonWidth = 112;

export function CellFocus({
  tools,
  object,
  onObject,
  onLeave,
}: {
  tools: ToolSession;
  object: string;
  onObject: (object: string) => void;
  onLeave: () => void;
}) {
  const { session, answer, setAnswer } = tools;
  const decisions = useDecisionSaves(session, session.style);
  const [camera, setCamera] = useState<Camera | null>(null);
  const cells = session.objects.filter((item) => item.kind === "cell" && item.object in cellShapes);
  const current = cells.find((item) => item.object === object);
  const spots: CellSpot[] = cells.flatMap((item) => {
    const shape = cellShapes[item.object];
    return shape
      ? [{ object: item.object, x: shape.x, y: shape.y, decided: !!answer(item.object) }]
      : [];
  });
  const keys = current ? answersOf(session.style, session.classes, current) : [];
  const decided = current ? answer(current.object) : undefined;

  const moveTo = (next: string | undefined) => {
    if (next === undefined) return;
    setCamera(null);
    onObject(next);
  };

  const decide = (raw: string) => {
    if (current === undefined) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const value = countsAs(session.style, raw, current);
    setAnswer(current.object, { value, raw, reasons: [], note: null });
    decisions.save(current.object, raw, value);
    const after = nearestOpen(
      spots.map((spot) => (spot.object === current.object ? { ...spot, decided: true } : spot)),
      current.object,
    );
    moveTo(after);
  };

  useAnswerKeys(keys, decide, current !== undefined);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog], [role=menu]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (event.key === "Escape") {
        onLeave();
        return;
      }
      if (event.key === "Enter" && !target.closest("button, a")) {
        event.preventDefault();
        onLeave();
        return;
      }
      const direction = directions[event.key];
      if (direction === undefined || event.shiftKey || current === undefined) return;
      event.preventDefault();
      moveTo(jumpTarget(spots, current.object, direction));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const slideLabel = session.slideName.split(" ")[0] ?? "";
  const zone = regionShapes.T2?.box ?? [0, 0, 0, 0];
  const locator: [number, number, number, number] = [
    (zone[0] + zone[2]) / 2 - 6,
    (zone[1] + zone[3]) / 2 - 6,
    12,
    12,
  ];
  const decidedCount = spots.filter((spot) => spot.decided).length;

  return (
    <main className="relative flex h-dvh bg-[#262626] text-fg" data-testid="cell-focus">
      <SlideStill
        view={{ kind: "cell", object }}
        camera={camera}
        onCameraChange={setCamera}
        regionDecisions={{}}
        bare
        minimap={false}
        hint={false}
        cellStyle={fadedCell}
        overlay={({ camera: shown, size }) => {
          const shape = cellShapes[object];
          const centre = shape
            ? {
                x: (shape.x - shown.x) * shown.scale + size.width / 2,
                y: (shape.y - shown.y) * shown.scale + size.height / 2,
              }
            : { x: size.width / 2, y: size.height / 2 };
          const width = Math.min(size.width - 24, keys.length * buttonWidth + 16);
          const box = placeBar(
            centre,
            ringRadius * shown.scale,
            { width, height: barHeight },
            size,
          );
          return (
            <>
              <FloatingPill>
                <b>{session.caseLabel ?? slideLabel}</b>
                <span className="text-fg-faint">
                  {slideLabel} · {object} · 40×
                </span>
                <button
                  type="button"
                  onClick={onLeave}
                  aria-label="Leave focus mode"
                  className="cursor-pointer border-0 bg-transparent p-0"
                >
                  <Keycap keys="Esc" size="sm" />
                </button>
              </FloatingPill>
              {current ? (
                <div
                  role="toolbar"
                  aria-label={`Type for ${object}`}
                  data-testid="cell-type-bar"
                  className="absolute z-4 flex items-center gap-1 rounded-zone border border-line bg-chrome p-1 shadow-pop"
                  style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                >
                  {keys.map((item) => (
                    <button
                      key={item.raw}
                      type="button"
                      aria-pressed={decided?.raw === item.raw}
                      onClick={() => decide(item.raw)}
                      className="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-ctl border-0 bg-transparent px-2 text-body-sm font-medium whitespace-nowrap text-fg hover:bg-chrome-2 aria-pressed:bg-accent-soft"
                    >
                      <Keycap action={item.action} keys={item.key} size="sm" />
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <SmartMinimap
                size="pip"
                image={overviewImage}
                extent={overviewExtent}
                title={null}
                data-testid="cell-locator"
                className="top-3.5 right-3.5"
              >
                <MapViewport rect={locator} />
              </SmartMinimap>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <MagnificationBar
                  magnification={40}
                  scaleLabel="10 µm"
                  scalePx={92}
                  micronsPerPixel={0.11}
                />
              </div>
              <span className="sr-only" aria-live="polite">
                {decidedCount} of {spots.length} cells decided
              </span>
            </>
          );
        }}
      />
    </main>
  );
}
