import { Keycap } from "@parfocal/ui/components/keycap";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { FloatingPill } from "@parfocal/ui/components/viewer-tools";
import { useEffect, useRef, useState } from "react";
import { useAnswerKeys } from "../review/answer-keys.ts";
import { type CellSpot, nearestOpen, panned } from "../review/cell-jump.ts";
import { cellShapes, regionShapes } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { chosenType, typeAnswers, typeChoice, typeOptions } from "../review/type-bar.ts";
import { cellCentre, TypeBar, useCellArrows } from "../review/type-bar.tsx";
import { useDecisionSaves } from "../review/use-decision-saves.ts";
import { lookUrl } from "../thumbnails.ts";
import { overviewExtent } from "./minimap-scenes.ts";
import type { ToolSession } from "./tool-session.tsx";

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const fadedCell = () => ({ stroke: "#ffffff", opacity: 0.12 });

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
  const { session, answer, setAnswer, paged } = tools;
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
  const decided = current ? answer(current.object) : undefined;
  const pagedFollow = paged?.follow;
  const here = cellShapes[object];
  const hereX = here ? Math.round(here.x / 150) * 150 : null;
  const hereY = here ? Math.round(here.y / 150) * 150 : null;
  useEffect(() => {
    pagedFollow?.(hereX === null || hereY === null ? null : { x: hereX, y: hereY });
  }, [pagedFollow, hereX, hereY]);
  const shownCamera = useRef<Camera | null>(null);

  const moveTo = (next: string | undefined) => {
    if (next === undefined) return;
    setCamera(null);
    onObject(next);
  };

  const decide = (raw: string) => {
    if (current === undefined) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const option = typeOptions.find((item) => item.id === raw);
    const choice = option
      ? typeChoice(session.style, option, current, session.classes)
      : { raw, value: "unsure" as const, reasons: [], draft: undefined };
    setAnswer(current.object, {
      value: choice.value,
      raw: choice.raw,
      reasons: choice.reasons,
      note: null,
    });
    decisions.save(current.object, choice.raw, choice.value, choice.draft);
    const after = nearestOpen(
      spots.map((spot) => (spot.object === current.object ? { ...spot, decided: true } : spot)),
      current.object,
    );
    moveTo(after);
  };

  useAnswerKeys(typeAnswers, decide, current !== undefined);

  useCellArrows({
    spots,
    current: current?.object,
    enabled: true,
    onJump: moveTo,
    onPan: (direction) => {
      if (shownCamera.current) setCamera(panned(shownCamera.current, direction));
    },
  });

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
      }
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
        onCellPick={moveTo}
        regionDecisions={{}}
        bare
        minimap={false}
        hint={false}
        cellStyle={paged ? (id) => paged.styleOf(id, fadedCell()) : fadedCell}
        overlay={({ camera: shown, size }) => {
          const centre = cellCentre(object, shown, size);
          shownCamera.current = shown;
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
                  aria-label="Esc, leave focus mode"
                  className="cursor-pointer border-0 bg-transparent p-0"
                >
                  <Keycap keys="Esc" size="sm" />
                </button>
              </FloatingPill>
              {current ? (
                <TypeBar
                  object={object}
                  centre={centre}
                  scale={shown.scale}
                  size={size}
                  chosen={chosenType(session.style, current, session.classes, decided)}
                  onChoose={(option) => decide(option.id)}
                />
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
